"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { usePortalContext } from "@/components/PortalProvider";
import {
  fmtUsd,
  getPortalMmm,
  MmmChannelCurve,
  MmmResponse,
  MmmSimulationChannelRow,
  simulateMmmBudget,
} from "@/lib/api";

const CHANNEL_LABELS: Record<string, string> = {
  own_spend_meta_usd: "Meta Paid Social",
  own_spend_youtube_usd: "YouTube Video",
  own_spend_search_usd: "Paid Search",
  own_spend_tiktok_usd: "TikTok Short-Form",
  own_spend_display_usd: "Programmatic Display",
};

const CHANNEL_COLORS = ["#2563eb", "#0d9488", "#d97706", "#dc2626", "#7c3aed"];

function formatChannelName(raw: string): string {
  if (CHANNEL_LABELS[raw]) return CHANNEL_LABELS[raw];
  const trimmed = raw.replace(/^own_spend_/, "").replace(/_usd$/, "");
  return trimmed
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hillResponse(spendUsd: number, curve: MmmChannelCurve): number {
  const x = Math.max(0, spendUsd);
  if (x <= 0) return 0;
  const k = Math.max(1e-6, curve.ec50_usd);
  const s = Math.max(0.1, curve.slope);
  const xs = Math.pow(x, s);
  const ks = Math.pow(k, s);
  return curve.beta * (xs / (xs + ks));
}

export default function MmmSimulatorPage() {
  return (
    <Suspense fallback={<p role="status">Loading weekly budget planner...</p>}>
      <MmmSimulatorContent />
    </Suspense>
  );
}

function MmmSimulatorContent() {
  const { myBrand } = usePortalContext();
  const searchParams = useSearchParams();
  const paramBrand = searchParams.get("brand_id") ?? "";
  const redirectedFromBrand = paramBrand && paramBrand !== myBrand ? paramBrand : null;

  const brandId = myBrand;
  const country = "Germany";
  const [panelType, setPanelType] = useState<"conversions" | "google_trends_proxy">("conversions");

  const [data, setData] = useState<MmmResponse | null>(null);
  const [channelSpends, setChannelSpends] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequestRef = useRef(0);

  useEffect(() => {
    const reqId = ++latestRequestRef.current;
    let cancelled = false;
    setLoading(true);
    setSimulating(false);
    setError(null);
    getPortalMmm(brandId, country, panelType)
      .then((res) => {
        if (cancelled || reqId !== latestRequestRef.current) return;
        setData(res);
        const initial: Record<string, number> = {};
        for (const row of res.simulation.channels) {
          initial[row.channel] = row.simulated_weekly_spend_usd;
        }
        setChannelSpends(initial);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!cancelled && reqId === latestRequestRef.current) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      latestRequestRef.current += 1;
    };
  }, [brandId, country, panelType]);

  async function runSimulation(optimize: boolean) {
    const reqId = ++latestRequestRef.current;
    setSimulating(true);
    setError(null);
    const totalBudget = Object.values(channelSpends).reduce((acc, v) => acc + v, 0);
    try {
      const res = await simulateMmmBudget({
        brand_id: brandId,
        country,
        total_budget_usd: optimize ? totalBudget : undefined,
        proposed_spend_by_channel: optimize ? undefined : channelSpends,
        optimize,
        panel_type: panelType,
      });
      if (reqId !== latestRequestRef.current) return;
      setData(res);
      const updated: Record<string, number> = {};
      for (const row of res.simulation.channels) {
        updated[row.channel] = row.simulated_weekly_spend_usd;
      }
      setChannelSpends(updated);
    } catch (err) {
      if (reqId !== latestRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      if (reqId === latestRequestRef.current) {
        setSimulating(false);
      }
    }
  }

  const simChannels = data?.simulation.channels ?? [];
  const totalShifted =
    simChannels.reduce((acc, c) => acc + Math.abs(c.spend_delta_usd), 0) / 2;
  const bestMarginal = [...simChannels].sort(
    (a, b) => b.marginal_response_per_usd - a.marginal_response_per_usd
  )[0];
  const mostSaturated = [...simChannels].sort((a, b) => b.saturation_pct - a.saturation_pct)[0];
  const scaleUpChannels = simChannels.filter((c) => c.spend_delta_usd > 100);
  const trimDownChannels = simChannels.filter((c) => c.spend_delta_usd < -100);
  const topTheme = data
    ? [...data.theme_attribution].sort(
        (a, b) => b.incremental_per_1k_usd - a.incremental_per_1k_usd
      )[0]
    : undefined;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">4. {myBrand} Weekly Budget &amp; ROI Planner</h1>
          <p className="page-subtitle">
            Test {myBrand}&apos;s 1st-party weekly channel budget shifts using historical diminishing-returns response curves (competitor spend is modeled as external market context), then inspect winning creative themes.
          </p>
        </div>

        <form className="form-row" onSubmit={(e) => e.preventDefault()} style={{ alignItems: "center" }}>
          <div className="badge badge-ok" style={{ padding: "0.45rem 0.75rem", fontSize: "0.88rem" }}>
            1st-Party Brand: {myBrand} ({country})
          </div>

          <fieldset style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "0.4rem 0.75rem" }}>
            <legend style={{ fontSize: "0.82rem", fontWeight: 600 }}>Goal Metric</legend>
            <div className="form-row" style={{ gap: "0.9rem" }}>
              <label className="inline-check" htmlFor="panel-conv">
                <input
                  id="panel-conv"
                  type="radio"
                  name="panel_type"
                  checked={panelType === "conversions"}
                  onChange={() => setPanelType("conversions")}
                />
                <span>Verified Conversions (Leads &amp; Sales)</span>
              </label>
              <label className="inline-check" htmlFor="panel-proxy">
                <input
                  id="panel-proxy"
                  type="radio"
                  name="panel_type"
                  checked={panelType === "google_trends_proxy"}
                  onChange={() => setPanelType("google_trends_proxy")}
                />
                <span>Search Interest Proxy (Demand Signal)</span>
              </label>
            </div>
          </fieldset>
        </form>
      </div>

      {redirectedFromBrand && (
        <div role="status" className="banner banner-warn">
          <span aria-hidden="true">&#9888;</span>
          <span>
            <strong>1st-Party MMM Governance: </strong>
            Step 4 optimizes only 1st-party spend for <strong>{myBrand}</strong> (competitor{" "}
            <strong>{redirectedFromBrand}</strong> spend is modeled as an external SOV control). Switch{" "}
            <strong>My Brand (1st-Party)</strong> in the top bar to change workspaces.
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="banner banner-danger">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      )}

      {loading && <p role="status">Loading channel response curves for {brandId}...</p>}

      {data && (
        <>
          {(data.roas_claim_blocked || data.is_proxy_outcome || data.is_spend_modeled) && (
            <div role="alert" className="banner banner-warn">
              <span aria-hidden="true">&#9888;</span>
              <div>
                <strong>
                  {data.roas_claim_blocked ? "ROAS CLAIM BLOCKED — " : "PLANNING NOTE — "}
                </strong>
                <span>{data.disclaimer}</span>
              </div>
            </div>
          )}

          <section className="kpi-grid" aria-label="Budget Simulation Summary">
            <article className="kpi-card">
              <p className="kpi-label">Current Weekly Budget</p>
              <p className="kpi-value">{fmtUsd(data.simulation.baseline_total_spend_usd)}</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">Proposed Weekly Budget</p>
              <p className="kpi-value">{fmtUsd(data.simulation.simulated_total_spend_usd)}</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">
                {data.roas_claim_blocked ? "Expected Search Interest Lift" : "Expected Conversion Lift"}
              </p>
              <p className="kpi-value">
                {data.simulation.expected_outcome_lift_pct >= 0 ? "+" : ""}
                {data.simulation.expected_outcome_lift_pct.toFixed(2)}%
              </p>
              <p className="kpi-note">
                Baseline {data.simulation.baseline_total_contribution.toFixed(1)} &rarr;{" "}
                {data.simulation.simulated_total_contribution.toFixed(1)}
              </p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">Active Model Scope</p>
              <p className="kpi-value">{data.artifact_scope?.brand_id} ({data.artifact_scope?.country_iso})</p>
              <p className="kpi-note">
                {data.roas_claim_blocked ? "Demand proxy index only" : "Incremental conversion ROI"}
                {data.artifact_scope?.used_fallback_scope ? " [fallback scope]" : ""}
              </p>
            </article>
          </section>

          {bestMarginal && mostSaturated && (
            <div role="region" aria-label="Executive Budget Takeaway" className="banner banner-ok">
              <span aria-hidden="true">&#10003;</span>
              <div>
                {totalShifted < 1 ? (
                  <>
                    <strong>Baseline Diagnosis: </strong>
                    <span>
                      <strong>{formatChannelName(bestMarginal.channel)}</strong> currently offers the
                      highest marginal return ({bestMarginal.saturation_pct.toFixed(0)}% saturated),
                      whereas <strong>{formatChannelName(mostSaturated.channel)}</strong> is at{" "}
                      {mostSaturated.saturation_pct.toFixed(0)}% saturation. Click{" "}
                      <strong>Recommend Optimal Split</strong> below to calculate the optimal weekly
                      reallocation
                      {topTheme && !data.roas_claim_blocked
                        ? `, and prioritize "${topTheme.theme_label}" creatives.`
                        : "."}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>Recommended Reallocation Summary: </strong>
                    <span>
                      Shifting <strong>{fmtUsd(totalShifted)}/wk</strong> from{" "}
                      <strong>
                        {trimDownChannels.map((c) => formatChannelName(c.channel)).join(", ") ||
                          "saturated channels"}
                      </strong>{" "}
                      into{" "}
                      <strong>
                        {scaleUpChannels.map((c) => formatChannelName(c.channel)).join(", ") ||
                          "high-headroom channels"}
                      </strong>{" "}
                      projects{" "}
                      <strong>
                        {data.simulation.expected_outcome_lift_pct >= 0 ? "+" : ""}
                        {data.simulation.expected_outcome_lift_pct.toFixed(2)}%
                      </strong>{" "}
                      lift in{" "}
                      {data.roas_claim_blocked
                        ? "Search Interest Proxy"
                        : "Verified Conversions"}
                      {topTheme
                        ? ` \u2014 pair incremental spend with top theme "${topTheme.theme_label}".`
                        : "."}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="card-grid">
            <section className="panel" aria-labelledby="sim-controls-heading">
              <h2 id="sim-controls-heading" className="panel-title">
                Adjust Weekly Channel Budgets
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runSimulation(false);
                }}
              >
                {data.simulation.channels.map((ch) => {
                  const currentVal = channelSpends[ch.channel] ?? ch.baseline_weekly_spend_usd;
                  const maxBound = Math.max(50000, Math.round(ch.baseline_weekly_spend_usd * 2.5));
                  const curve = data.channels[ch.channel];
                  return (
                    <div key={ch.channel} className="field" style={{ marginBlockEnd: "0.9rem" }}>
                      <label htmlFor={`slider-${ch.channel}`}>
                        {formatChannelName(ch.channel)}: <strong>{fmtUsd(currentVal)}</strong> / wk{" "}
                        {curve && !data.roas_claim_blocked && (
                          <span className="kpi-note">
                            (Expected return {curve.roas_mean.toFixed(2)}x | 90% range [{curve.roas_hdi_90[0].toFixed(2)}, {curve.roas_hdi_90[1].toFixed(2)}])
                          </span>
                        )}
                      </label>
                      <input
                        id={`slider-${ch.channel}`}
                        type="range"
                        min={1000}
                        max={maxBound}
                        step={500}
                        value={Math.round(currentVal)}
                        onChange={(e) =>
                          setChannelSpends((prev) => ({
                            ...prev,
                            [ch.channel]: Number(e.target.value),
                          }))
                        }
                      />
                    </div>
                  );
                })}
                <div className="form-row">
                  <button type="submit" className="btn" disabled={simulating}>
                    {simulating ? "Simulating..." : "Forecast Custom Split"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={simulating}
                    onClick={() => void runSimulation(true)}
                  >
                    {simulating ? "Optimizing..." : "Recommend Optimal Split"}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel" aria-labelledby="theme-attr-heading">
              <div className="page-header" style={{ marginBlockEnd: "0.75rem" }}>
                <div>
                  <h2 id="theme-attr-heading" className="panel-title" style={{ margin: 0 }}>
                    Creative Theme ROI Attribution
                  </h2>
                  <p className="kpi-note" style={{ marginBlockStart: "0.2rem" }}>
                    Estimated contribution by narrative theme (modeled separately from channel mix).
                  </p>
                </div>
                <Link href="/themes" className="btn">
                  Back to Step 2: Themes &rarr;
                </Link>
              </div>
              <div tabIndex={0} role="region" aria-labelledby="theme-attr-heading" className="table-wrapper responsive-stack">
                <table>
                  <caption>Incremental efficiency by creative messaging theme</caption>
                  <thead>
                    <tr>
                      <th scope="col">Theme Label</th>
                      <th scope="col">Ad Spend</th>
                      <th scope="col">Spend Share</th>
                      <th scope="col">Lift per $1k</th>
                      <th scope="col">Contribution Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.theme_attribution.map((t) => (
                      <tr key={t.theme_label}>
                        <th scope="row">{t.theme_label}</th>
                        <td data-label="Ad Spend">{fmtUsd(t.total_spend_usd)}</td>
                        <td data-label="Spend Share">{t.spend_share_pct.toFixed(1)}%</td>
                        <td data-label="Lift per $1k">
                          {data.roas_claim_blocked ? "Blocked in Proxy Mode" : t.incremental_per_1k_usd.toFixed(3)}
                        </td>
                        <td data-label="Contribution Share">{t.contribution_share_pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="card-grid">
            <section className="panel" aria-labelledby="realloc-table-heading">
              <h2 id="realloc-table-heading" className="panel-title">
                Recommended Channel Reallocation
              </h2>
              <p className="kpi-note" style={{ marginBlockEnd: "0.75rem" }}>
                Side-by-side comparison of current baseline vs. proposed weekly spend and saturation headroom.
              </p>
              <div tabIndex={0} role="region" aria-labelledby="realloc-table-heading" className="table-wrapper responsive-stack">
                <table>
                  <caption>Weekly spend reallocation and saturation status per channel</caption>
                  <thead>
                    <tr>
                      <th scope="col">Channel</th>
                      <th scope="col">Baseline / wk</th>
                      <th scope="col">Proposed / wk</th>
                      <th scope="col">Shift (&Delta;)</th>
                      <th scope="col">Saturation</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simChannels.map((ch) => {
                      const deltaPrefix =
                        ch.spend_delta_usd > 0 ? "+" : ch.spend_delta_usd < 0 ? "-" : "";
                      const actionBadge =
                        ch.spend_delta_usd >= 250
                          ? { cls: "badge-ok", label: "Scale Up" }
                          : ch.spend_delta_usd <= -250
                          ? { cls: "badge-warn", label: "Trim Saturated" }
                          : { cls: "", label: `Hold Steady (${ch.saturation_pct.toFixed(0)}% sat)` };
                      return (
                        <tr key={ch.channel}>
                          <th scope="row">{formatChannelName(ch.channel)}</th>
                          <td data-label="Baseline / wk">{fmtUsd(ch.baseline_weekly_spend_usd)}</td>
                          <td data-label="Proposed / wk">{fmtUsd(ch.simulated_weekly_spend_usd)}</td>
                          <td data-label="Shift (Δ)">
                            {deltaPrefix}
                            {fmtUsd(Math.abs(ch.spend_delta_usd))}
                          </td>
                          <td data-label="Saturation">{ch.saturation_pct.toFixed(0)}%</td>
                          <td data-label="Action">
                            <span className={`badge ${actionBadge.cls}`}>{actionBadge.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel" aria-labelledby="hill-curves-heading">
              <h2 id="hill-curves-heading" className="panel-title">
                Diminishing Returns (Hill Response Curves)
              </h2>
              <ResponseCurvesSvg
                curves={data.channels}
                simChannels={simChannels}
                roasBlocked={data.roas_claim_blocked}
              />
            </section>
          </div>

          <details className="panel diag-drawer">
            <summary>
              Statistical Model Fit &amp; Convergence Diagnostics (3-Tier Calibration Ladder)
            </summary>
            <p className="kpi-note" style={{ marginBlockEnd: "0.75rem" }}>
              Out-of-sample holdout validation comparing Tier 1 (Proportional Baseline), Tier 2 (Ridge Diminishing Returns), and Champion Tier 3 (Bayesian PyMC + nutpie Adstock/Hill). R-hat &lt; 1.05 and 0 divergences indicate clean convergence.
            </p>
            <div tabIndex={0} role="region" aria-label="MMM Model Calibration Ladder" className="table-wrapper">
              <table>
                <caption>Model validation metrics across calibration tiers</caption>
                <thead>
                  <tr>
                    <th scope="col">Model Tier</th>
                    <th scope="col">RMSE</th>
                    <th scope="col">MAPE %</th>
                    <th scope="col">R&sup2;</th>
                    <th scope="col">MCMC R-hat / Divergences</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ladder_comparison.map((row) => (
                    <tr key={row.tier}>
                      <th scope="row">{row.tier}</th>
                      <td>{row.rmse.toFixed(2)}</td>
                      <td>{row.mape_pct.toFixed(2)}%</td>
                      <td>{row.r2.toFixed(4)}</td>
                      <td>
                        {row.max_rhat !== undefined && row.max_rhat !== null
                          ? `${row.max_rhat.toFixed(4)} / ${row.divergences ?? 0} div`
                          : "Deterministic"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </>
  );
}

function ResponseCurvesSvg({
  curves,
  simChannels,
  roasBlocked,
}: {
  curves: Record<string, MmmChannelCurve>;
  simChannels: MmmSimulationChannelRow[];
  roasBlocked: boolean;
}) {
  if (!simChannels.length) {
    return <p className="page-subtitle">No channel response curves loaded for this brand.</p>;
  }

  const maxSpend = Math.max(
    80000,
    ...simChannels.map(
      (c) => Math.max(c.baseline_weekly_spend_usd, c.simulated_weekly_spend_usd) * 1.15
    )
  );
  const steps = 24;
  const series = simChannels
    .map((row, idx) => {
      const curve = curves[row.channel];
      if (!curve) return null;
      const pts: Array<{ spend: number; contrib: number }> = [];
      for (let i = 0; i <= steps; i++) {
        const spend = (i / steps) * maxSpend;
        pts.push({ spend, contrib: hillResponse(spend, curve) });
      }
      return {
        row,
        curve,
        color: CHANNEL_COLORS[idx % CHANNEL_COLORS.length],
        pts,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (!series.length) {
    return <p className="page-subtitle">Channel Hill curve parameters unavailable.</p>;
  }

  const maxContrib =
    Math.max(
      1e-3,
      ...series.flatMap((s) => s.pts.map((p) => p.contrib)),
      ...series.map((s) => Math.max(s.row.baseline_contribution, s.row.simulated_contribution))
    ) * 1.08;

  const left = 62;
  const right = 576;
  const top = 18;
  const bottom = 266;
  const width = right - left;
  const height = bottom - top;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const mapX = (s: number) => left + (s / maxSpend) * width;
  const mapY = (y: number) => bottom - (y / maxContrib) * height;

  return (
    <figure style={{ margin: 0 }}>
      <svg
        role="img"
        aria-label="Channel Hill saturation response curves comparing baseline vs proposed weekly spend"
        viewBox="0 0 600 320"
        style={{
          inlineSize: "100%",
          blockSize: "auto",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          background: "var(--surface-alt)",
        }}
      >
        {ticks.map((t) => {
          const gx = left + t * width;
          const gy = bottom - t * height;
          const xLabel = `$${Math.round((t * maxSpend) / 1000)}k`;
          const yLabel = (t * maxContrib).toFixed(0);
          return (
            <g key={t}>
              <line x1={gx} y1={top} x2={gx} y2={bottom} stroke="var(--border)" strokeDasharray="3 4" strokeWidth="1" />
              <line x1={left} y1={gy} x2={right} y2={gy} stroke="var(--border)" strokeDasharray="3 4" strokeWidth="1" />
              <text x={gx} y={bottom + 16} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
                {xLabel}
              </text>
              <text x={left - 8} y={gy + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
                {yLabel}
              </text>
            </g>
          );
        })}

        <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="var(--text-muted)" strokeWidth="1.5" />
        <line x1={left} y1={top} x2={left} y2={bottom} stroke="var(--text-muted)" strokeWidth="1.5" />

        <text x={(left + right) / 2} y={306} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text)">
          Weekly Channel Spend (USD)
        </text>
        <text
          x={16}
          y={(top + bottom) / 2}
          textAnchor="middle"
          fontSize="12"
          fontWeight="600"
          fill="var(--text)"
          transform={`rotate(-90 16 ${(top + bottom) / 2})`}
        >
          {roasBlocked ? "Search Proxy Index Contribution" : "Expected Weekly Contribution"}
        </text>

        {series.map(({ row, color, pts }) => {
          const polylinePts = pts.map((p) => `${mapX(p.spend).toFixed(1)},${mapY(p.contrib).toFixed(1)}`).join(" ");
          const bx = mapX(row.baseline_weekly_spend_usd);
          const by = mapY(row.baseline_contribution);
          const sx = mapX(row.simulated_weekly_spend_usd);
          const sy = mapY(row.simulated_contribution);
          const label = formatChannelName(row.channel);
          return (
            <g key={row.channel}>
              <polyline fill="none" stroke={color} strokeWidth="2.4" points={polylinePts} />
              <circle cx={bx} cy={by} r="4.5" fill="var(--surface)" stroke={color} strokeWidth="2">
                <title>{`${label} Baseline: ${fmtUsd(row.baseline_weekly_spend_usd)}/wk`}</title>
              </circle>
              <circle cx={sx} cy={sy} r="5.5" fill={color} stroke="var(--surface)" strokeWidth="1.5">
                <title>{`${label} Proposed: ${fmtUsd(row.simulated_weekly_spend_usd)}/wk (${row.saturation_pct.toFixed(0)}% saturated)`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <figcaption className="legend-row">
        {series.map(({ row, color }) => (
          <span key={row.channel} className="legend-item">
            <span className="legend-swatch" style={{ backgroundColor: color }} aria-hidden="true" />
            <span>{formatChannelName(row.channel)}</span>
          </span>
        ))}
        <span>&middot; Hollow circle = baseline, solid dot = proposed spend.</span>
      </figcaption>
    </figure>
  );
}
