"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export const EU_AUTO_BRANDS = ["BMW", "Mercedes-Benz", "Audi", "Porsche"] as const;
export type EuAutoBrand = (typeof EU_AUTO_BRANDS)[number];

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export const DEFAULT_WELCOME_TURN: ChatTurn = {
  id: "welcome",
  role: "assistant",
  text: "Hello! Ask plain-English questions about brand share of spend, creative messaging themes, worn-out ads needing refresh, or weekly budget planning across Germany, the UK, and France.",
};

const STORAGE_TURNS_KEY = "cis_copilot_turns_v1";
const STORAGE_SESSION_KEY = "cis_copilot_session_id_v1";
const STORAGE_MY_BRAND_KEY = "cis_my_brand_v1";

function createPortalSessionId(): string {
  return `portal-${Math.random().toString(36).slice(2, 10)}`;
}

function extractAdkText(payload: Record<string, unknown>): string {
  const content = payload.content as { parts?: Array<{ text?: string }> } | undefined;
  if (content?.parts && Array.isArray(content.parts)) {
    const texts = content.parts.map((p) => p.text).filter((t): t is string => Boolean(t));
    if (texts.length > 0) return texts.join("\n");
  }
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.output === "string") return payload.output;
  if (typeof payload.message === "string") return payload.message;
  return "";
}

interface PortalContextValue {
  myBrand: EuAutoBrand;
  setMyBrand: (brand: EuAutoBrand) => void;
  turns: ChatTurn[];
  prompt: string;
  setPrompt: (value: string) => void;
  streaming: boolean;
  streamError: string | null;
  sessionId: string;
  sendMessage: (text: string) => Promise<void>;
  handleNewChat: () => void;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const [myBrand, setMyBrandState] = useState<EuAutoBrand>("BMW");
  const [turns, setTurns] = useState<ChatTurn[]>([DEFAULT_WELCOME_TURN]);
  const [prompt, setPrompt] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>("portal-session");
  const [storageHydrated, setStorageHydrated] = useState(false);

  const inFlightRef = useRef(false);
  const sessionIdRef = useRef("portal-session");

  useEffect(() => {
    try {
      const storedBrand = window.sessionStorage.getItem(STORAGE_MY_BRAND_KEY);
      if (storedBrand && (EU_AUTO_BRANDS as readonly string[]).includes(storedBrand)) {
        setMyBrandState(storedBrand as EuAutoBrand);
      }

      const existingSid = window.sessionStorage.getItem(STORAGE_SESSION_KEY);
      if (existingSid && existingSid.trim()) {
        sessionIdRef.current = existingSid;
        setSessionId(existingSid);
      } else {
        const freshSid = createPortalSessionId();
        window.sessionStorage.setItem(STORAGE_SESSION_KEY, freshSid);
        sessionIdRef.current = freshSid;
        setSessionId(freshSid);
      }

      const rawTurns = window.sessionStorage.getItem(STORAGE_TURNS_KEY);
      if (rawTurns) {
        const parsed = JSON.parse(rawTurns) as unknown;
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every(
            (t) =>
              typeof t === "object" &&
              t !== null &&
              typeof (t as ChatTurn).id === "string" &&
              ((t as ChatTurn).role === "user" || (t as ChatTurn).role === "assistant") &&
              typeof (t as ChatTurn).text === "string"
          )
        ) {
          const sanitized = (parsed as ChatTurn[]).map((t) =>
            t.role === "assistant" && !t.text.trim()
              ? {
                  ...t,
                  text: "[Stream interrupted by page reload — click a prompt or re-send your question.]",
                }
              : t
          );
          setTurns(sanitized);
        }
      }
    } catch {
      // Ignore storage access/parse errors
    } finally {
      setStorageHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    try {
      window.sessionStorage.setItem(STORAGE_TURNS_KEY, JSON.stringify(turns));
    } catch {
      // Ignore storage quota errors
    }
  }, [turns, storageHydrated]);

  const setMyBrand = useCallback((next: EuAutoBrand) => {
    setMyBrandState(next);
    try {
      window.sessionStorage.setItem(STORAGE_MY_BRAND_KEY, next);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleNewChat = useCallback(() => {
    if (inFlightRef.current) return;
    const freshSid = createPortalSessionId();
    sessionIdRef.current = freshSid;
    setSessionId(freshSid);
    setTurns([DEFAULT_WELCOME_TURN]);
    setStreamError(null);
    try {
      window.sessionStorage.setItem(STORAGE_SESSION_KEY, freshSid);
      window.sessionStorage.setItem(STORAGE_TURNS_KEY, JSON.stringify([DEFAULT_WELCOME_TURN]));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || inFlightRef.current) return;

    inFlightRef.current = true;
    const activeSessionId = sessionIdRef.current;
    setStreamError(null);
    setStreaming(true);

    const userTurnId = `u-${Date.now()}`;
    const assistantTurnId = `a-${Date.now()}`;
    setTurns((prev) => [
      ...prev,
      { id: userTurnId, role: "user", text: trimmed },
      { id: assistantTurnId, role: "assistant", text: "" },
    ]);
    setPrompt("");

    try {
      const response = await fetch("/query/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          user_id: "portal-analyst",
          session_id: activeSessionId,
        }),
      });

      if (response.status === 409) {
        const body = await response.json().catch(() => ({ detail: "Session busy." }));
        throw new Error(`HTTP 409 Concurrent Request Guard: ${body.detail || "Session already busy."}`);
      }
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}: Failed to stream response from Copilot backend.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let accumulated = "";

      const processSseLine = (rawLine: string) => {
        const line = rawLine.trimEnd();
        if (!line || line.startsWith(":")) return;
        if (!line.startsWith("data:")) return;

        const jsonText = line.slice(5).trim();
        if (!jsonText) return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          accumulated += (accumulated ? "\n" : "") + jsonText;
          setTurns((prev) =>
            prev.map((t) => (t.id === assistantTurnId ? { ...t, text: accumulated } : t))
          );
          return;
        }

        if (!parsed || typeof parsed !== "object") return;
        const payload = parsed as Record<string, unknown>;
        if (payload.error_message) {
          throw new Error(String(payload.error_message));
        }

        const chunkText = extractAdkText(payload);
        if (chunkText) {
          accumulated += (accumulated ? "\n\n" : "") + chunkText;
          setTurns((prev) =>
            prev.map((t) => (t.id === assistantTurnId ? { ...t, text: accumulated } : t))
          );
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          processSseLine(rawLine);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        for (const rawLine of buffer.split(/\r?\n/)) {
          processSseLine(rawLine);
        }
      }

      if (!accumulated) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTurnId
              ? {
                  ...t,
                  text: "Query completed with empty text payload. Inspect another portal view for tabular data.",
                }
              : t
          )
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown streaming failure";
      setStreamError(msg);
      setTurns((prev) =>
        prev.map((t) => (t.id === assistantTurnId ? { ...t, text: `[Error] ${msg}` } : t))
      );
    } finally {
      inFlightRef.current = false;
      setStreaming(false);
    }
  }, []);

  return (
    <PortalContext.Provider
      value={{
        myBrand,
        setMyBrand,
        turns,
        prompt,
        setPrompt,
        streaming,
        streamError,
        sessionId,
        sendMessage,
        handleNewChat,
      }}
    >
      {children}
    </PortalContext.Provider>
  );
}

export function usePortalContext(): PortalContextValue {
  const ctx = useContext(PortalContext);
  if (!ctx) {
    throw new Error("usePortalContext must be used inside <PortalProvider>");
  }
  return ctx;
}
