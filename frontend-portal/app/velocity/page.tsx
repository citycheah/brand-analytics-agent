"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePortal } from "@/context/PortalContext";
import { formatCompactNumber } from "@/lib/analytics";
import { getPortalVelocity } from "@/lib/api";
import type { VelocityResponse } from "@/lib/types";

function formatUsdCost(cost: number): string {
  return cost < 1 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

export default function VelocityPage() {
  const { theme } = usePortal();
  const [data, setData] = useState<VelocityResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [chartsReady, setChartsReady] = useState(false);

  useEffect(() => {
    setChartsReady(true);
  }, []);

  useEffect(() => {
    let active = true;
    setErrorMsg(null);
    getPortalVelocity({ top_k: 20, brand_id: "all" })
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err: unknown) => {
        if (active) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : "Failed to load System Health telemetry."
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const gridStroke = theme === "dark" ? "#27272a" : "#e4e4e7";
  const tickFill = theme === "dark" ? "#a1a1aa" : "#52525b";

  if (errorMsg) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
      >
        Failed to load Velocity & Ops telemetry: {errorMsg}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 animate-pulse" />
        <div className="h-72 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 animate-pulse" />
      </div>
    );
  }

  const sortedDrift = [...data.drift_report.features].sort(
    (a, b) => b.psi - a.psi
  );
  const chartDrift = sortedDrift.slice(0, 10);
  const tableDrift = sortedDrift.slice(0, 20);
  const maxPsi = chartDrift.reduce((m, r) => Math.max(m, r.psi), 0);
  const psiDomainMax = Math.max(0.35, Math.ceil(maxPsi * 11.5) / 10);

  const alertFeatures = sortedDrift.filter((f) => f.status === "alert");
  const topFeature = sortedDrift[0];

  const finopsUtilizationPct =
    (data.finops_summary.total_cost_usd /
      Math.max(data.finops_summary.budget_cap_usd, 1)) *
    100;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            System Health & Model Governance
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            YouTube velocity scoring throughput, PSI feature drift telemetry,
            FinOps LLM cost ledger, and Golden Vision evaluation gates.
          </p>
        </div>

        <Link
          href="/themes#youtube-momentum"
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
        >
          <span>View YouTube Breakouts in Step 2</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Model Health & Recommended Action Banner (Preserved from Phase 4.2) */}
      <section
        aria-labelledby="ops-action-heading"
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3
            id="ops-action-heading"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            Model Health & Recommended Action
          </h3>
          <span
            className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${
              alertFeatures.length > 0
                ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300"
            }`}
          >
            {alertFeatures.length > 0
              ? `${alertFeatures.length} Feature Drift Alert (Organic YouTube Velocity Model)`
              : "All Monitored Features Stable"}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            What Drifted & Why:{" "}
          </span>
          {alertFeatures.length > 0
            ? `${alertFeatures[0].feature_name} (PSI ${alertFeatures[0].psi.toFixed(4)} > 0.25 threshold) shifted due to recent EU OEM upload spikes changing 30-day baseline engagement distributions.`
            : topFeature
              ? `All monitored T0 features remain within stable PSI bounds (highest baseline feature: ${topFeature.feature_name} at PSI ${topFeature.psi.toFixed(4)}).`
              : "No feature distribution drift signals reported."}
        </p>
        <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            What Is Unaffected:{" "}
          </span>
          Paid Share of Spend/Voice (Step 2), Vision Creative Tagging (Step 3),
          and Bayesian/Ridge MMM Budget Planning (Step 4) do{" "}
          <span className="font-semibold">not</span> use this feature and remain
          100% unaffected.
        </p>
        <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            Recommended Next Action:{" "}
          </span>
          Treat organic YouTube breakout probabilities near the p ≥{" "}
          {(data.drift_report.alert_threshold ?? 0.2136).toFixed(2)} threshold
          as directional until the rolling 30-day engagement baseline window
          updates.
        </p>
      </section>

      {/* Top 4 Summary Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            YouTube Scored Videos
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {data.total_scored_videos.toLocaleString()}
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-amber-700 dark:text-amber-400">
            {data.predicted_breakouts} predicted breakouts
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            PSI Feature Drift Alerts
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-rose-700 dark:text-rose-400">
            {alertFeatures.length} Alert
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            {sortedDrift.filter((f) => f.status === "warning").length} warning ·{" "}
            {sortedDrift.filter((f) => f.status === "ok").length} ok
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            FinOps LLM Spend (Ledger)
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatUsdCost(data.finops_summary.total_cost_usd)}
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            {data.finops_summary.total_calls.toLocaleString()} calls ·{" "}
            {data.finops_summary.failed_calls} failed
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Golden Vision Eval
          </div>
          <div
            className={`mt-1.5 text-2xl font-semibold ${
              data.vision_eval.manifest_present
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-700 dark:text-rose-400"
            }`}
          >
            {data.vision_eval.manifest_present
              ? "Gates Armed"
              : "Manifest Missing"}
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            {data.vision_eval.positive_cases} pos /{" "}
            {data.vision_eval.negative_trap_cases} traps (
            {data.vision_eval.evaluated_samples} total)
          </div>
        </div>
      </section>

      {/* PSI Feature Drift Chart + Table */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              PSI Feature Drift Monitor (Top 10 of {sortedDrift.length} Features)
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Population Stability Index sorted descending against{" "}
              {data.drift_report.reference_window} (Alert ≥ 0.25 · Warning ≥
              0.10).
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            Evaluated {data.drift_report.evaluated_at.slice(0, 10) || "n/a"}
          </span>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-6 h-[300px] w-full">
            {chartsReady ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartDrift}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 16, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={gridStroke}
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    domain={[0, psiDomainMax]}
                    tick={{ fill: tickFill, fontSize: 11 }}
                    axisLine={{ stroke: gridStroke }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="feature_name"
                    width={235}
                    tick={{ fill: tickFill, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor:
                        theme === "dark" ? "#18181b" : "#ffffff",
                      borderColor: theme === "dark" ? "#3f3f46" : "#e4e4e7",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    formatter={(val: unknown) => [
                      Number(val).toFixed(4),
                      "PSI",
                    ]}
                  />
                  <ReferenceLine
                    x={0.25}
                    stroke="#e11d48"
                    strokeDasharray="3 3"
                  />
                  <ReferenceLine
                    x={0.1}
                    stroke="#d97706"
                    strokeDasharray="3 3"
                  />
                  <Bar
                    dataKey="psi"
                    name="PSI Score"
                    radius={[0, 4, 4, 0]}
                    barSize={16}
                  >
                    {chartDrift.map((entry) => (
                      <Cell
                        key={entry.feature_name}
                        fill={
                          entry.status === "alert"
                            ? "#e11d48"
                            : entry.status === "warning"
                              ? "#d97706"
                              : "#16a34a"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full rounded-lg bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
            )}
          </div>

          <div className="xl:col-span-6 overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">
                  <th className="py-2 pr-3 font-medium">Feature</th>
                  <th className="py-2 px-3 font-medium text-right">PSI</th>
                  <th className="py-2 px-3 font-medium text-right">
                    Baseline Mean
                  </th>
                  <th className="py-2 px-3 font-medium text-right">
                    Current Mean
                  </th>
                  <th className="py-2 pl-3 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {tableDrift.map((row) => {
                  const statusClasses =
                    row.status === "alert"
                      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
                      : row.status === "warning"
                        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300";
                  return (
                    <tr key={row.feature_name}>
                      <td className="py-2.5 pr-3 font-mono text-zinc-900 dark:text-zinc-100">
                        {row.feature_name}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                        {row.psi.toFixed(4)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {row.baseline_mean.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                        {row.current_mean.toFixed(2)}
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase ${statusClasses}`}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FinOps LLM Ledger + Golden Vision Eval Pass Gates */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* FinOps LLM Ledger */}
        <section className="xl:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                FinOps LLM Ledger
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {data.finops_summary.period_label}
              </p>
            </div>
            <div className="text-right font-mono tabular-nums">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {formatUsdCost(data.finops_summary.total_cost_usd)} / $
                {data.finops_summary.budget_cap_usd.toFixed(0)} cap
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {finopsUtilizationPct.toFixed(1)}% utilized ·{" "}
                {data.finops_summary.total_calls.toLocaleString()} calls ·{" "}
                {data.finops_summary.failed_calls} failed
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">
                  <th className="py-2 pr-3 font-medium">Pipeline Stage</th>
                  <th className="py-2 px-3 font-medium">SKU / Model</th>
                  <th className="py-2 px-3 font-medium text-right">Calls</th>
                  <th className="py-2 px-3 font-medium text-right">Failed</th>
                  <th className="py-2 pl-3 font-medium text-right">
                    Cost (USD)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {data.finops_summary.stages.map((st) => (
                  <tr key={`${st.stage}-${st.model}`}>
                    <td className="py-2.5 pr-3 font-medium text-zinc-900 dark:text-zinc-100">
                      {st.stage}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {st.model}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                      {st.calls.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                      {st.failed_calls}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                      {formatUsdCost(st.cost_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Golden Vision Eval Pass Gates */}
        <section className="xl:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Golden Vision Eval Pass Gates
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {data.vision_eval.dataset_name} ·{" "}
              {data.vision_eval.evaluated_samples} manifest cases
            </p>
          </div>

          <div className="space-y-3">
            {data.vision_eval.gates.map((gate) => {
              const hasMeasured = gate.actual !== null && gate.passed !== null;
              const isHealthy = hasMeasured
                ? Boolean(gate.passed)
                : data.vision_eval.manifest_present;
              const badgeLabel = hasMeasured
                ? gate.passed
                  ? "PASS"
                  : "FAIL"
                : data.vision_eval.manifest_present
                  ? "ARMED"
                  : "MISSING";

              return (
                <div
                  key={gate.metric_key}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {gate.label}
                    </div>
                    <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {gate.metric_key} ({gate.operator}{" "}
                      {(gate.threshold * 100).toFixed(1)}%)
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="font-mono tabular-nums text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {gate.actual !== null
                        ? `${(gate.actual * 100).toFixed(1)}%`
                        : `${gate.operator} ${(gate.threshold * 100).toFixed(0)}%`}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                        isHealthy
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
                      }`}
                    >
                      {isHealthy ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <XCircle className="h-3 w-3" />
                      )}
                      <span>{badgeLabel}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* YouTube Breakout Queue Summary Table */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            YouTube Breakout Scoring Queue
          </h3>
          <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            Top {data.breakout_queue.length} scored videos
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 text-zinc-500 dark:text-zinc-400">
                <th className="py-2.5 px-4 font-medium">Sub-Brand</th>
                <th className="py-2.5 px-3 font-medium">Title</th>
                <th className="py-2.5 px-3 font-medium">Market</th>
                <th className="py-2.5 px-3 font-medium text-right">
                  30d Avg Views
                </th>
                <th className="py-2.5 px-3 font-medium text-right">
                  Signal / Thresh
                </th>
                <th className="py-2.5 px-4 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {data.breakout_queue.map((v) => (
                <tr key={v.video_id}>
                  <td className="py-2.5 px-4 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                    {v.sub_brand_label}
                  </td>
                  <td className="py-2.5 px-3 text-zinc-700 dark:text-zinc-300 max-w-[340px] truncate">
                    {v.title}
                  </td>
                  <td className="py-2.5 px-3 text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                    {v.country}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                    {formatCompactNumber(v.views_7d)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-amber-700 dark:text-amber-400">
                    {v.velocity_multiplier.toFixed(1)}x
                  </td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    <span
                      className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                        v.predicted_breakout
                          ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300"
                          : "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {v.predicted_breakout ? "Breakout" : "Monitoring"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
