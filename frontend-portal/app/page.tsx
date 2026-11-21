"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  ChatTurn,
  EU_AUTO_BRANDS,
  usePortalContext,
} from "@/components/PortalProvider";
import { fmtCompact, fmtUsd, getPortalOverview, PortalOverviewResponse } from "@/lib/api";

function getSuggestedLinks(turn: ChatTurn, idx: number): Array<{ href: string; label: string }> {
  if (
    idx === 0 ||
    turn.role !== "assistant" ||
    !turn.text.trim() ||
    turn.text.startsWith("[Error]") ||
    turn.text.startsWith("[Stream interrupted")
  ) {
    return [];
  }

  const lower = turn.text.toLowerCase();
  const links: Array<{ href: string; label: string }> = [];
  const add = (href: string, label: string) => {
    if (!links.some((l) => l.href === href)) {
      links.push({ href, label });
    }
  };

  if (/fatigue|wearout|worn-out|decay|theme|whitespace|battleground|share of|sos|sov/.test(lower)) {
    add("/themes", "Open Step 2: Market Share & Themes \u2192");
    add("/creatives", "Inspect Flagged Ads in Step 3 \u2192");
  }
  if (/budget|roas|roi|channel|spend split|mmm|saturat|hill/.test(lower)) {
    add("/mmm", "Simulate Split in Step 4: Budget Planner \u2192");
  }
  if (/youtube|breakout|velocity|organic|drift|psi/.test(lower)) {
    add("/themes#youtube-momentum", "View YouTube Breakouts in Step 2 \u2192");
  }
  if (links.length === 0) {
    add("/themes", "Open Step 2: Market Share & Themes \u2192");
    add("/mmm", "Open Step 4: Budget Planner \u2192");
  }
  return links;
}

export default function CopilotOverviewPage() {
  const {
    myBrand,
    turns,
    prompt,
    setPrompt,
    streaming,
    streamError,
    sessionId,
    sendMessage,
    handleNewChat,
  } = usePortalContext();

  const [overview, setOverview] = useState<PortalOverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const lastCompositionEndRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPortalOverview()
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setOverviewError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void sendMessage(prompt);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // IME-safe guard (modern-web-guidance: isComposing + timestamp window fallback)
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (
        lastCompositionEndRef.current !== null &&
        Math.abs(event.timeStamp - lastCompositionEndRef.current) < 50
      ) {
        return;
      }
      formRef.current?.requestSubmit();
    }
  }

  const competitors = EU_AUTO_BRANDS.filter((b) => b !== myBrand);
  const suggestedPrompts = [
    `Compare ${myBrand} vs. ${competitors.join(", ")} ad spend vs impression share in Germany for 2025.`,
    `Which creative themes are uncontested opportunities for ${myBrand} in Germany, and which ads show audience wearout?`,
    `Recommend an optimal $65k weekly budget split across channels for ${myBrand} in Germany.`,
    `Which EU automotive YouTube channels have breakout organic videos vs. ${myBrand} this week?`,
  ];

  const mkt = overview?.market_highlight;
  const vel = overview?.velocity_highlight;
  const thm = overview?.theme_summary;
  const mmm = overview?.mmm_highlight;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">1. Executive Copilot &amp; Workflow Hub</h1>
          <p className="page-subtitle">
            Ask questions across EU automotive campaigns or move step-by-step from competitive diagnosis to {myBrand}&apos;s 1st-party budget allocation.
          </p>
        </div>
        <div className="form-row" style={{ alignItems: "center" }}>
          <span className="badge badge-ok">1st-Party Workspace: {myBrand}</span>
          <span className="badge" aria-label={`Session ID ${sessionId}`}>
            Session: {sessionId}
          </span>
          <button
            type="button"
            className="btn"
            onClick={handleNewChat}
            disabled={streaming}
          >
            New Chat
          </button>
        </div>
      </div>

      {overviewError ? (
        <div role="alert" className="banner banner-warn">
          <span aria-hidden="true">!</span>
          <span>Live summary unavailable ({overviewError}). Ensure the portal API server is running.</span>
        </div>
      ) : (
        <section aria-label="Marketing Performance Snapshot" className="kpi-grid">
          <article className="kpi-card">
            <p className="kpi-label">Germany Ad Spend (Tracked)</p>
            <p className="kpi-value">{mkt ? fmtUsd(mkt.total_spend_usd) : "..."}</p>
            <p className="kpi-note">{mkt ? `${fmtCompact(mkt.total_impressions)} paid impressions` : "Loading..."}</p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Human-Verified Ad Accuracy</p>
            <p className="kpi-value">{mkt ? `${mkt.audit_coverage_pct.toFixed(1)}%` : "..."}</p>
            <p className="kpi-note">
              <Link href="/creatives">Review or correct AI ad tags &rarr;</Link>
            </p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Creative Themes &amp; Wearout</p>
            <p className="kpi-value">{thm ? `${thm.theme_count} active themes` : "..."}</p>
            <p className="kpi-note">
              {thm ? (
                <>
                  {thm.fatigued_creative_count} ads needing refresh &middot;{" "}
                  <Link href="/themes">View queue &rarr;</Link>
                </>
              ) : (
                "Loading..."
              )}
            </p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">EU Auto YouTube Breakouts</p>
            <p className="kpi-value">
              {vel ? `${vel.predicted_breakouts} breakout videos` : "..."}
            </p>
            <p className="kpi-note">
              {vel ? (
                <>
                  Out of {vel.total_scored_videos} tracked OEM uploads &middot;{" "}
                  <Link href="/themes#youtube-momentum">See channels &rarr;</Link>
                </>
              ) : (
                "Loading..."
              )}
            </p>
          </article>
        </section>
      )}

      <section className="panel" aria-labelledby="workflow-heading">
        <h2 id="workflow-heading" className="panel-title">
          How These Views Work Together ({myBrand} vs. Competitors)
        </h2>
        <div className="workflow-strip">
          <div className="workflow-step">
            <span className="workflow-step-num">Step 1 · Ask Questions</span>
            <strong>Executive Copilot (Here)</strong>
            <span className="kpi-note">
              Summarize {myBrand} vs. competitor performance, spot wearout, or ask for budget advice in plain English.
            </span>
          </div>
          <Link href="/themes" className="workflow-step">
            <span className="workflow-step-num">Step 2 · Diagnose Market</span>
            <strong>Market Share &amp; Themes &rarr;</strong>
            <span className="kpi-note">
              Compare {myBrand} vs. rivals on Spend vs. Voice share, whitespace themes, ad wearout, and YouTube buzz.
            </span>
          </Link>
          <Link href="/creatives" className="workflow-step">
            <span className="workflow-step-num">Step 3 · Verify Creatives</span>
            <strong>Ad Creative Review &rarr;</strong>
            <span className="kpi-note">
              Inspect visual hooks of {myBrand} and competitor ads, and save instant human corrections to brand or theme tags.
            </span>
          </Link>
          <Link href="/mmm" className="workflow-step">
            <span className="workflow-step-num">Step 4 · Reallocate Spend</span>
            <strong>{myBrand} Budget &amp; ROI Planner &rarr;</strong>
            <span className="kpi-note">
              Shift {myBrand}&apos;s 1st-party weekly budget from saturating channels into high-return channels and winning themes.
            </span>
          </Link>
        </div>
      </section>

      <section className="panel" aria-labelledby="copilot-heading">
        <h2 id="copilot-heading" className="panel-title">
          Ask the Marketing Copilot
        </h2>

        <div className="form-row" style={{ marginBlockEnd: "0.75rem" }}>
          {suggestedPrompts.map((sample, idx) => (
            <button
              key={idx}
              type="button"
              className="btn"
              disabled={streaming}
              onClick={() => void sendMessage(sample)}
            >
              {sample.slice(0, 62)}...
            </button>
          ))}
        </div>

        <div className="chat-transcript" aria-label="Copilot conversation">
          {turns.map((turn, idx) => {
            const suggested = getSuggestedLinks(turn, idx);
            return (
              <article
                key={turn.id}
                className={`chat-bubble ${turn.role === "user" ? "chat-bubble-user" : ""}`}
              >
                <strong>{turn.role === "user" ? "You" : "Copilot"}:</strong>
                <div>{turn.text || (streaming ? "Thinking..." : "")}</div>
                {suggested.length > 0 && (
                  <div
                    className="form-row"
                    style={{ marginBlockStart: "0.55rem", whiteSpace: "normal" }}
                    aria-label="Suggested next steps"
                  >
                    {suggested.map((item) => (
                      <Link key={item.href} href={item.href} className="btn">
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {streamError && (
          <div role="alert" className="banner banner-danger" style={{ marginBlockStart: "0.75rem" }}>
            <span aria-hidden="true">!</span>
            <span>{streamError}</span>
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit} style={{ marginBlockStart: "0.85rem" }}>
          <div className="field">
            <label htmlFor="copilot-prompt">Ask a question about {myBrand}, competitors, ads, or budgets</label>
            <textarea
              id="copilot-prompt"
              name="prompt"
              rows={3}
              style={{ inlineSize: "100%" }}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionEnd={(e) => {
                lastCompositionEndRef.current = e.timeStamp;
              }}
              placeholder={`Ask about ${myBrand} vs. competitors in Germany, creative wearout, brand tag corrections, or weekly budget splits...`}
              required
            />
          </div>
          <div className="form-row" style={{ marginBlockStart: "0.6rem" }}>
            <button type="submit" className="btn btn-primary" disabled={streaming}>
              {streaming ? "Thinking..." : "Send Question"}
            </button>
            <span className="kpi-note" role="status" aria-live="polite">
              {streaming
                ? "Streaming answer from analyst backend (you can switch tabs without interrupting)..."
                : "Press Enter to send, Shift+Enter for a new line."}
            </span>
          </div>
        </form>
      </section>

      <details className="panel diag-drawer">
        <summary>Technical Diagnostics &amp; AI Model Telemetry</summary>
        <div className="kpi-grid">
          <div className="kpi-card">
            <p className="kpi-label">Category Theme HHI</p>
            <p className="kpi-value">{thm ? thm.category_hhi.toFixed(0) : "..."}</p>
            <p className="kpi-note">Concentration tier: {thm?.hhi_concentration ?? "..."}</p>
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Velocity Model Feature Drift</p>
            <p className="kpi-value">{vel ? vel.drift_status : "..."}</p>
            <p className="kpi-note">{vel ? `Mean PSI ${vel.mean_psi.toFixed(4)}` : "Loading..."}</p>
          </div>
          <div className="kpi-card">
            <p className="kpi-label">AI Labeling Spend &amp; Eval</p>
            <p className="kpi-value">{vel ? `$${vel.finops_spend_usd.toFixed(4)}` : "..."}</p>
            <p className="kpi-note">{vel ? `Vision Golden Eval: ${vel.golden_eval_cases} cases` : "Loading..."}</p>
          </div>
          <div className="kpi-card">
            <p className="kpi-label">Default MMM Benchmark</p>
            <p className="kpi-value">
              {myBrand} ({mmm?.country_iso ?? "DE"})
            </p>
            <p className="kpi-note">
              <Link href="/velocity">Open full System Health &amp; PSI log &rarr;</Link>
            </p>
          </div>
        </div>
      </details>
    </>
  );
}
