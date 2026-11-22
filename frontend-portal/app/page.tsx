"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, RotateCcw, Send, Square } from "lucide-react";
import { usePortal, type RoutePath } from "@/context/PortalContext";
import { formatCompactNumber, formatCurrency } from "@/lib/analytics";
import { buildCopilotSuggestedPrompts, getPortalOverview } from "@/lib/api";
import { BRAND_CATALOG, type PortalOverviewResponse } from "@/lib/types";

const WORKFLOW_STEPS: Array<{
  step: string;
  title: string;
  subtitle: string;
  path: RoutePath;
}> = [
  {
    step: "01",
    title: "Executive Copilot",
    subtitle: "Synthesize briefs & deep-link",
    path: "/",
  },
  {
    step: "02",
    title: "Market Share & Themes",
    subtitle: "SOS/SOV, UMAP & wearout",
    path: "/themes",
  },
  {
    step: "03",
    title: "Ad Creative Review",
    subtitle: "Hook playbooks & HITL audit",
    path: "/creatives",
  },
  {
    step: "04",
    title: "Budget & ROI Planner",
    subtitle: "1st-party Bayesian MMM",
    path: "/mmm",
  },
];

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith("**") && tok.endsWith("**")) {
      return (
        <strong
          key={i}
          className="font-semibold text-zinc-900 dark:text-zinc-50"
        >
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
      return (
        <em key={i} className="italic text-zinc-600 dark:text-zinc-300">
          {tok.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={i}>{tok}</React.Fragment>;
  });
}

function FormattedMessage({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line) return <div key={idx} className="h-1" />;
        if (line.startsWith("### ")) {
          return (
            <h3
              key={idx}
              className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 pt-1"
            >
              {line.slice(4)}
            </h3>
          );
        }
        if (line.startsWith("- ")) {
          return (
            <div key={idx} className="flex gap-2 pl-1">
              <span className="text-zinc-400 dark:text-zinc-500 select-none">
                •
              </span>
              <span>{renderInlineMarkdown(line.slice(2))}</span>
            </div>
          );
        }
        if (/^\d+\.\s/.test(line)) {
          const match = line.match(/^(\d+\.)\s(.*)$/);
          if (match) {
            return (
              <div key={idx} className="flex gap-2 pl-1">
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400 pt-0.5 tabular-nums">
                  {match[1]}
                </span>
                <span>{renderInlineMarkdown(match[2])}</span>
              </div>
            );
          }
        }
        return <p key={idx}>{renderInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

export default function CopilotPage() {
  const {
    myBrandId,
    navigate,
    auditVersion,
    sessionId,
    messages,
    isStreaming,
    streamError,
    sendMessage,
    resetChat,
    stopStreaming,
  } = usePortal();

  const [overview, setOverview] = useState<PortalOverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    setOverviewError(null);
    getPortalOverview()
      .then((data) => {
        if (active) setOverview(data);
      })
      .catch((err: unknown) => {
        if (active) {
          setOverviewError(
            err instanceof Error
              ? err.message
              : "Failed to load executive overview."
          );
        }
      });
    return () => {
      active = false;
    };
  }, [auditVersion]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, isStreaming]);

  const brandName = BRAND_CATALOG[myBrandId].name;
  const suggestedPrompts = buildCopilotSuggestedPrompts(myBrandId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    const text = input;
    setInput("");
    await sendMessage(text);
  };

  return (
    <div className="space-y-6">
      {overviewError && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200"
        >
          Live portal telemetry unavailable ({overviewError}). Ensure FastAPI
          backend `:8000` is running.
        </div>
      )}

      {/* Top 4-KPI Snapshot Row */}
      <section
        aria-label="Executive KPI Snapshot"
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
      >
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Germany Ad Spend
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
              {overview
                ? formatCurrency(overview.germany_ad_spend_usd, true)
                : "—"}
            </span>
            <span className="text-xs font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {overview
                ? `${formatCompactNumber(overview.germany_ad_spend_impressions)} impr.`
                : ""}
            </span>
          </div>
          <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            4 EU OEMs · Tracked lakehouse
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Human-Verified Ad Accuracy
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
              {overview
                ? `${overview.human_verified_accuracy_pct.toFixed(1)}%`
                : "—"}
            </span>
            <span className="text-xs font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {overview
                ? `${overview.audit_coverage_pct.toFixed(1)}% audited`
                : ""}
            </span>
          </div>
          <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
            {overview
              ? `${overview.verified_assets} / ${overview.total_assets} assets verified`
              : "Loading audit state"}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Active Themes & Wearout
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
              {overview ? `${overview.active_themes_count} Themes` : "—"}
            </span>
            <span className="text-xs font-mono tabular-nums text-rose-700 dark:text-rose-400">
              {overview ? `${overview.wearout_alerts_count} fatigued` : ""}
            </span>
          </div>
          <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
            {overview
              ? `${formatCurrency(overview.wearout_spend_at_risk_usd, true)}/wk spend at risk`
              : "Loading wearout queue"}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            EU Auto YouTube Breakouts
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
              {overview ? `${overview.youtube_breakouts_count} Active` : "—"}
            </span>
            <span className="text-xs font-mono tabular-nums text-amber-700 dark:text-amber-400">
              {overview
                ? `Peak ${overview.top_breakout_velocity_x.toFixed(1)}x thresh.`
                : ""}
            </span>
          </div>
          <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            OEM & sub-brand velocity signals
          </div>
        </div>
      </section>

      {/* Compact Clickable 4-Step Workflow Strip */}
      <nav
        aria-label="4-step workflow progression"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        {WORKFLOW_STEPS.map((item) => {
          const isCurrent = item.path === "/";
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`group flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                isCurrent
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                  : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      isCurrent
                        ? "text-zinc-300 dark:text-zinc-600"
                        : "text-zinc-400 dark:text-zinc-500"
                    }`}
                  >
                    {item.step}
                  </span>
                  <span className="text-sm font-medium truncate">
                    {item.title}
                  </span>
                </div>
                <div
                  className={`mt-0.5 text-xs truncate ${
                    isCurrent
                      ? "text-zinc-300 dark:text-zinc-600"
                      : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {item.subtitle}
                </div>
              </div>
              <ArrowRight
                className={`h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 ${
                  isCurrent
                    ? "text-zinc-300 dark:text-zinc-600"
                    : "text-zinc-400 dark:text-zinc-500"
                }`}
              />
            </Link>
          );
        })}
      </nav>

      {/* Main Conversational Copilot Workspace */}
      <section
        aria-label="Executive Copilot Workspace"
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 flex flex-col overflow-hidden"
      >
        {/* Copilot Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Executive Copilot · {brandName} (1st-Party Context)
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Grounded in EU Auto SOS/SOV, creative wearout, YouTube velocity, and
              Germany Bayesian MMM.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-block rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              {sessionId}
            </span>
            {isStreaming && (
              <button
                type="button"
                onClick={stopStreaming}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300 transition-colors whitespace-nowrap"
              >
                <Square className="h-3 w-3 fill-current" />
                <span>Stop Stream</span>
              </button>
            )}
            <button
              type="button"
              disabled={isStreaming}
              onClick={resetChat}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>New Chat</span>
            </button>
          </div>
        </div>

        {/* Message Stream */}
        <div
          data-testid="copilot-message-list"
          className="px-5 py-5 space-y-4 min-h-[300px] max-h-[480px] overflow-y-auto"
        >
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[88%] rounded-xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "bg-zinc-50 border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
                }`}
              >
                {msg.role === "user" ? (
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                ) : (
                  <div>
                    <FormattedMessage
                      content={
                        msg.content ||
                        (msg.streaming ? "Synthesizing telemetry..." : "")
                      }
                    />
                    {msg.streaming && (
                      <div className="mt-2 text-xs font-mono text-emerald-700 dark:text-emerald-400">
                        Streaming response...
                      </div>
                    )}
                    {!msg.streaming &&
                      msg.nextSteps &&
                      msg.nextSteps.length > 0 && (
                        <div className="mt-3.5 pt-3 border-t border-zinc-200/80 dark:border-zinc-800 flex flex-wrap gap-2">
                          {msg.nextSteps.map((link) => (
                            <button
                              key={link.path + link.label}
                              type="button"
                              onClick={() => navigate(link.path)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:border-zinc-400 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-900 transition-colors whitespace-nowrap"
                            >
                              <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                                Step {link.step}
                              </span>
                              <span>{link.label}</span>
                              <ArrowRight className="h-3 w-3 text-zinc-400" />
                            </button>
                          ))}
                        </div>
                      )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {streamError && (
          <div
            role="alert"
            className="mx-5 mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
          >
            {streamError}
          </div>
        )}

        {/* Suggested Brand-Aware Prompt Chips */}
        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50">
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
            Suggested prompts for {brandName}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={isStreaming}
                onClick={() => sendMessage(prompt)}
                className="text-left rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100 transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Input Composer */}
        <form
          onSubmit={handleSubmit}
          className="px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 flex items-center gap-2.5"
        >
          <label htmlFor="copilot-prompt-input" className="sr-only">
            Ask Executive Copilot
          </label>
          <input
            id="copilot-prompt-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask about ${brandName} share of voice, fatigued creatives, or Germany MMM lift...`}
            disabled={isStreaming}
            className="flex-1 h-10 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-zinc-900 px-4 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Send</span>
          </button>
        </form>
      </section>
    </div>
  );
}
