"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { streamCopilotQuery } from "@/lib/api";
import { BRAND_CATALOG, type BrandId, type ChatMessage } from "@/lib/types";

export type RoutePath = "/" | "/themes" | "/creatives" | "/mmm" | "/velocity";

interface PortalContextValue {
  myBrandId: BrandId;
  setMyBrandId: (brand: BrandId) => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  routePath: RoutePath;
  navigate: (to: string) => void;
  auditVersion: number;
  bumpAuditVersion: () => void;
  sessionId: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingBrandId: BrandId | null;
  streamError: string | null;
  sendMessage: (prompt: string) => Promise<void>;
  resetChat: () => void;
  stopStreaming: () => void;
}

const PortalContext = createContext<PortalContextValue | null>(null);

const STORAGE_MY_BRAND_KEY = "cis_my_brand_id";
const STORAGE_COLOR_SCHEME_KEY = "color-scheme";
const STORAGE_SESSION_KEY = "cis_copilot_session_id_v1";
const STORAGE_TURNS_KEY = "cis_copilot_turns_v1";

function normalizeRoutePath(pathname: string): RoutePath {
  if (pathname.startsWith("/themes")) return "/themes";
  if (pathname.startsWith("/creatives")) return "/creatives";
  if (pathname.startsWith("/mmm")) return "/mmm";
  if (pathname.startsWith("/velocity")) return "/velocity";
  return "/";
}

function isBrandId(val: unknown): val is BrandId {
  return val === "bmw" || val === "mercedes" || val === "audi" || val === "porsche";
}

function createPortalSessionId(): string {
  return `portal-${Math.random().toString(36).slice(2, 10)}`;
}

function createWelcomeMessage(brandId: BrandId): ChatMessage {
  const brand = BRAND_CATALOG[brandId].name;
  return {
    id: `welcome-${brandId}`,
    role: "assistant",
    createdAt: "2026-01-01T00:00:00.000Z",
    content: `Ready for **${brand}** (1st-Party) EU Automotive intelligence across **Germany, United Kingdom, and France**. Ask about share-of-voice efficiency gaps, creative wearout decay, organic YouTube sub-brand breakouts, or Bayesian MMM budget reallocation — or launch a quick prompt below.`,
    nextSteps: [
      { label: "Explore Market Share & Themes", path: "/themes", step: 2 },
      { label: `Review ${brand} Creatives`, path: `/creatives?brand_id=${brandId}`, step: 3 },
      { label: `Open ${brand} Budget & ROI Planner`, path: "/mmm", step: 4 },
    ],
  };
}

function applySchemeToDom(
  resolvedTheme: "light" | "dark",
  metaContent: "light" | "dark" | "light dark"
): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.style.removeProperty("color-scheme");
  const metas = document.querySelectorAll('meta[name="color-scheme"]');
  if (metas[0]) {
    metas[0].setAttribute("content", metaContent);
  }
  for (let i = 1; i < metas.length; i += 1) {
    metas[i].remove();
  }
}

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const routePath = useMemo(() => normalizeRoutePath(pathname ?? "/"), [pathname]);

  // Deterministic initial state for SSR/CSR hydration parity (#418-safe)
  const [myBrandId, setMyBrandIdState] = useState<BrandId>("bmw");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [auditVersion, setAuditVersion] = useState(0);

  const [sessionId, setSessionId] = useState<string>("portal-session");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    createWelcomeMessage("bmw"),
  ]);
  const [storageHydrated, setStorageHydrated] = useState(false);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingBrandId, setStreamingBrandId] = useState<BrandId | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef("portal-session");
  const myBrandRef = useRef<BrandId>("bmw");

  // Post-mount hydration of brand, theme, session ID, and chat history
  useEffect(() => {
    let hydratedBrand: BrandId = "bmw";
    try {
      const storedBrand = window.localStorage.getItem(STORAGE_MY_BRAND_KEY);
      if (isBrandId(storedBrand)) {
        hydratedBrand = storedBrand;
        myBrandRef.current = storedBrand;
        setMyBrandIdState(storedBrand);
      }
    } catch {
      // Ignore storage access errors
    }

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const resolveAndApplyTheme = () => {
      let storedScheme: string | null = null;
      try {
        storedScheme = window.localStorage.getItem(STORAGE_COLOR_SCHEME_KEY);
      } catch {
        storedScheme = null;
      }
      if (storedScheme === "dark" || storedScheme === "light") {
        setTheme(storedScheme);
        applySchemeToDom(storedScheme, storedScheme);
      } else {
        const systemResolved: "light" | "dark" = mql.matches ? "dark" : "light";
        setTheme(systemResolved);
        applySchemeToDom(systemResolved, "light dark");
      }
    };
    resolveAndApplyTheme();

    const handleSystemChange = () => {
      let storedScheme: string | null = null;
      try {
        storedScheme = window.localStorage.getItem(STORAGE_COLOR_SCHEME_KEY);
      } catch {
        storedScheme = null;
      }
      if (storedScheme !== "dark" && storedScheme !== "light") {
        const next: "light" | "dark" = mql.matches ? "dark" : "light";
        setTheme(next);
        applySchemeToDom(next, "light dark");
      }
    };
    mql.addEventListener("change", handleSystemChange);

    const handleStorageSync = (e: StorageEvent) => {
      if (e.key === STORAGE_COLOR_SCHEME_KEY) {
        resolveAndApplyTheme();
      } else if (e.key === STORAGE_MY_BRAND_KEY && isBrandId(e.newValue)) {
        myBrandRef.current = e.newValue;
        setMyBrandIdState(e.newValue);
      }
    };
    window.addEventListener("storage", handleStorageSync);

    try {
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
              typeof (t as ChatMessage).id === "string" &&
              ((t as ChatMessage).role === "user" ||
                (t as ChatMessage).role === "assistant") &&
              typeof (t as ChatMessage).content === "string"
          )
        ) {
          const sanitized = (parsed as ChatMessage[]).map((t) =>
            t.role === "assistant" && (t.streaming || !t.content.trim())
              ? {
                  ...t,
                  streaming: false,
                  content:
                    t.content.trim() ||
                    "[Stream interrupted by page reload — click a prompt or re-send your question.]",
                }
              : t
          );
          setMessages(sanitized);
        } else {
          setMessages([createWelcomeMessage(hydratedBrand)]);
        }
      } else {
        setMessages([createWelcomeMessage(hydratedBrand)]);
      }
    } catch {
      setMessages([createWelcomeMessage(hydratedBrand)]);
    } finally {
      setStorageHydrated(true);
    }

    return () => {
      mql.removeEventListener("change", handleSystemChange);
      window.removeEventListener("storage", handleStorageSync);
    };
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    try {
      window.sessionStorage.setItem(STORAGE_TURNS_KEY, JSON.stringify(messages));
    } catch {
      // Ignore storage quota errors
    }
  }, [messages, storageHydrated]);

  const setMyBrandId = useCallback((brand: BrandId) => {
    myBrandRef.current = brand;
    setMyBrandIdState(brand);
    try {
      window.localStorage.setItem(STORAGE_MY_BRAND_KEY, brand);
    } catch {
      // Ignore storage errors
    }
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].id.startsWith("welcome-")) {
        return [createWelcomeMessage(brand)];
      }
      return prev;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    const systemTheme: "light" | "dark" = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches
      ? "dark"
      : "light";
    setTheme((prev) => {
      const target: "light" | "dark" = prev === "dark" ? "light" : "dark";
      try {
        if (target === systemTheme) {
          window.localStorage.removeItem(STORAGE_COLOR_SCHEME_KEY);
          applySchemeToDom(target, "light dark");
        } else {
          window.localStorage.setItem(STORAGE_COLOR_SCHEME_KEY, target);
          applySchemeToDom(target, target);
        }
      } catch {
        applySchemeToDom(target, target);
      }
      return target;
    });
  }, []);

  const navigate = useCallback(
    (to: string) => {
      router.push(to);
      if (!to.includes("#")) {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    },
    [router]
  );

  const bumpAuditVersion = useCallback(() => {
    setAuditVersion((v) => v + 1);
  }, []);

  const stopStreaming = useCallback(() => {
    const activeController = abortControllerRef.current;
    abortControllerRef.current = null;
    activeController?.abort();
    inFlightRef.current = false;
    setIsStreaming(false);
    setStreamingBrandId(null);
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    );
  }, []);

  const resetChat = useCallback(() => {
    if (inFlightRef.current) return;
    const freshSid = createPortalSessionId();
    sessionIdRef.current = freshSid;
    setSessionId(freshSid);
    const welcome = [createWelcomeMessage(myBrandRef.current)];
    setMessages(welcome);
    setStreamError(null);
    try {
      window.sessionStorage.setItem(STORAGE_SESSION_KEY, freshSid);
      window.sessionStorage.setItem(STORAGE_TURNS_KEY, JSON.stringify(welcome));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const sendMessage = useCallback(async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt || inFlightRef.current) return;

    inFlightRef.current = true;
    const activeBrand = myBrandRef.current;
    const activeSessionId = sessionIdRef.current;
    setStreamError(null);
    setIsStreaming(true);
    setStreamingBrandId(activeBrand);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt,
      createdAt: new Date().toISOString(),
    };
    const assistantId = `asst-${Date.now() + 1}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const { nextSteps } = await streamCopilotQuery({
        message: prompt,
        user_id: "portal-analyst",
        session_id: activeSessionId,
        my_brand_id: activeBrand,
        signal: controller.signal,
        onChunk: (delta) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + delta } : m
            )
          );
        },
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false, nextSteps } : m
        )
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        const messageText =
          err instanceof Error ? err.message : "Unable to complete stream.";
        setStreamError(messageText);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  content:
                    m.content || `[Error] ${messageText}`,
                }
              : m
          )
        );
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        inFlightRef.current = false;
        setIsStreaming(false);
        setStreamingBrandId(null);
      }
    }
  }, []);

  const value = useMemo<PortalContextValue>(
    () => ({
      myBrandId,
      setMyBrandId,
      theme,
      toggleTheme,
      sidebarCollapsed,
      setSidebarCollapsed,
      routePath,
      navigate,
      auditVersion,
      bumpAuditVersion,
      sessionId,
      messages,
      isStreaming,
      streamingBrandId,
      streamError,
      sendMessage,
      resetChat,
      stopStreaming,
    }),
    [
      myBrandId,
      setMyBrandId,
      theme,
      toggleTheme,
      sidebarCollapsed,
      routePath,
      navigate,
      auditVersion,
      bumpAuditVersion,
      sessionId,
      messages,
      isStreaming,
      streamingBrandId,
      streamError,
      sendMessage,
      resetChat,
      stopStreaming,
    ]
  );

  return (
    <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
  );
}

export function usePortal(): PortalContextValue {
  const ctx = useContext(PortalContext);
  if (!ctx) {
    throw new Error("usePortal must be used inside <PortalProvider>");
  }
  return ctx;
}
