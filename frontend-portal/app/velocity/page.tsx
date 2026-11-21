"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtCompact, getPortalVelocity, VelocityResponse } from "@/lib/api";

export default function VelocityOpsPage() {
  const [data, setData] = useState<VelocityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPortalVelocity(15)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const featureRows = Object.values(data?.drift_report?.feature_results ?? {}).sort(
    (a, b) => b.psi - a.psi
  );
  const driftedRows = featureRows.filter((f) => f.status === "drift_alert");
  const topFeature = featureRows[0];
  const finopsCost =
    data?.finops_summary?.total_estimated_cost_usd ??
    data?.finops_summary?.total_cost_usd ??
    0;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">System Health, ML Drift &amp; AI Ops</h1>
          <p className="page-subtitle">
            Underlying model health metrics: Population Stability Index (PSI) drift checks, Gemini API FinOps spend ledger, and Vision Eval quality gates.
          </p>
        </div>
        <Link href="/themes#youtube-momentum" className="btn">
          View YouTube Breakouts in Step 2 &rarr;
        </Link>
      </div>

      <div className="banner banner-warn">
        <span aria-hidden="true">i</span>
        <span>
          Organic EU Automotive YouTube Breakout Momentum is now embedded directly inside{" "}
          <Link href="/themes#youtube-momentum">Step 2: Market Share &amp; Themes</Link> alongside paid campaigns.
        </span>
      </div>

      {error && (
        <div role="alert" className="banner banner-danger">
          <span aria-hidden="true">!</span>
          <span>Failed to load Velocity &amp; Ops artifacts: {error}</span>
        </div>
      )}

      {loading && <p role="status">Loading velocity scores &amp; ops telemetry...</p>}

      {data && (
        <>
          <section className="panel" aria-labelledby="ops-action-heading">
            <div className="form-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h2 id="ops-action-heading" className="panel-title" style={{ margin: 0 }}>
                Model Health &amp; Recommended Action
              </h2>
              <span className={`badge ${driftedRows.length > 0 ? "badge-warn" : "badge-ok"}`}>
                {driftedRows.length > 0
                  ? `${driftedRows.length} Feature Drift Alert (Organic YouTube Velocity Model)`
                  : "All Monitored Features Stable"}
              </span>
            </div>
            <p className="kpi-note" style={{ marginBlockStart: "0.55rem", color: "var(--text)" }}>
              <strong>What Drifted &amp; Why:</strong>{" "}
              {driftedRows.length > 0
                ? `${driftedRows[0].feature_name} (PSI ${driftedRows[0].psi.toFixed(4)} > 0.25 threshold) shifted due to recent EU OEM upload spikes changing 30-day baseline engagement distributions.`
                : topFeature
                ? `All monitored T0 features remain within stable PSI bounds (highest baseline feature: ${topFeature.feature_name} at PSI ${topFeature.psi.toFixed(4)} \u2264 0.25).`
                : "No feature distribution drift signals reported."}
            </p>
            <p className="kpi-note" style={{ marginBlockStart: "0.35rem", color: "var(--text)" }}>
              <strong>What Is Unaffected:</strong> Paid Share of Spend/Voice (Step 2), Vision Creative
              Tagging (Step 3), and Bayesian/Ridge MMM Budget Planning (Step 4) do{" "}
              <strong>not</strong> use this feature and remain 100% unaffected.
            </p>
            <p className="kpi-note" style={{ marginBlockStart: "0.35rem", color: "var(--text)" }}>
              <strong>Recommended Next Action:</strong> Treat organic YouTube breakout probabilities
              near the p &ge; {data.drift_report.alert_threshold?.toFixed(2) ?? "0.24"} threshold as
              directional until the rolling 30-day engagement baseline window updates.
            </p>
          </section>

          <section className="kpi-grid" aria-label="AI Ops Summary KPIs">
            <article className="kpi-card">
              <p className="kpi-label">Breakout Alerts / Scored Videos</p>
              <p className="kpi-value">
                {data.predicted_breakouts} / {data.total_scored_videos}
              </p>
              <p className="kpi-note">
                Threshold p &ge; {data.drift_report.alert_threshold?.toFixed(2) ?? "n/a"}
              </p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">PSI Drift Status</p>
              <p className="kpi-value">{data.drift_report.overall_status ?? "unknown"}</p>
              <p className="kpi-note">
                Mean PSI {(data.drift_report.mean_psi ?? 0).toFixed(4)} &middot; Max{" "}
                {(data.drift_report.max_psi ?? 0).toFixed(4)}
              </p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">FinOps Ledger Spend</p>
              <p className="kpi-value">${finopsCost.toFixed(4)}</p>
              <p className="kpi-note">
                {data.finops_summary.total_calls ?? 0} logged calls ({data.finops_summary.failed_calls ?? 0} failed)
              </p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">{data.vision_eval.benchmark_name}</p>
              <p className="kpi-value">{data.vision_eval.total_cases} cases</p>
              <p className="kpi-note">
                {data.vision_eval.positive_cases} positives / {data.vision_eval.negative_trap_cases} traps &middot; F1 &ge; {data.vision_eval.gates.min_brand_f1}
              </p>
            </article>
          </section>

          <section className="panel" aria-labelledby="breakouts-heading">
            <h2 id="breakouts-heading" className="panel-title">
              Competitor Video Breakout Queue (Top {data.breakout_queue.length})
            </h2>
            <div tabIndex={0} role="region" aria-labelledby="breakouts-heading" className="table-wrapper responsive-stack">
              <table>
                <caption>Predicted high-velocity competitor uploads ranked by breakout probability</caption>
                <thead>
                  <tr>
                    <th scope="col">Video</th>
                    <th scope="col">Channel</th>
                    <th scope="col">Prob</th>
                    <th scope="col">Alert</th>
                    <th scope="col">7d Blitz</th>
                    <th scope="col">30d Avg Views</th>
                  </tr>
                </thead>
                <tbody>
                  {data.breakout_queue.map((v) => (
                    <tr key={v.video_id}>
                      <th scope="row">{v.title || v.video_id}</th>
                      <td data-label="Channel">{v.channel_title}</td>
                      <td data-label="Prob">{(v.breakout_prob * 100).toFixed(1)}%</td>
                      <td data-label="Alert">
                        <span className={`badge ${v.is_predicted_breakout ? "badge-warn" : ""}`}>
                          {v.is_predicted_breakout ? "BREAKOUT" : "Normal"}
                        </span>
                      </td>
                      <td data-label="7d Blitz">{v.channel_upload_blitz_7d} uploads</td>
                      <td data-label="30d Avg Views">{fmtCompact(v.channel_historical_avg_views_30d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="panel diag-drawer">
            <summary>
              Feature Distribution Drift Report (PSI — {featureRows.length} monitored T0 signals)
            </summary>
            <div tabIndex={0} role="region" aria-label="Feature Distribution Drift Table" className="table-wrapper responsive-stack">
              <table>
                <caption>Population Stability Index (PSI) across monitored T0 features</caption>
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    <th scope="col">PSI</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {featureRows.slice(0, 20).map((f) => (
                    <tr key={f.feature_name}>
                      <th scope="row">{f.feature_name}</th>
                      <td data-label="PSI">{f.psi.toFixed(4)}</td>
                      <td data-label="Status">
                        <span
                          className={`badge ${
                            f.status === "drift_alert"
                              ? "badge-danger"
                              : f.status === "warning"
                              ? "badge-warn"
                              : "badge-ok"
                          }`}
                        >
                          {f.status}
                        </span>
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
