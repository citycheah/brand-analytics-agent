"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Lock,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePortal } from "@/context/PortalContext";
import { evaluateHillResponse, formatCurrency } from "@/lib/analytics";
import { getPortalMmm, simulateMmm, toUiBrandId } from "@/lib/api";
import {
  BRAND_CATALOG,
  CHANNEL_COLORS,
  type MmmChannelKey,
  type MmmPanelType,
  type MmmResponse,
} from "@/lib/types";

const CHANNEL_KEYS: MmmChannelKey[] = [
  "own_spend_meta_usd",
  "own_spend_youtube_usd",
  "own_spend_tiktok_usd",
  "own_spend_display_usd",
];

function buildInitialSpendMap(res: MmmResponse): Record<MmmChannelKey, number> {
  return {
    own_spend_meta_usd:
      res.channels.own_spend_meta_usd?.baseline_spend_usd ?? 0,
    own_spend_youtube_usd:
      res.channels.own_spend_youtube_usd?.baseline_spend_usd ?? 0,
    own_spend_tiktok_usd:
      res.channels.own_spend_tiktok_usd?.baseline_spend_usd ?? 0,
    own_spend_display_usd:
      res.channels.own_spend_display_usd?.baseline_spend_usd ?? 0,
  };
}

export default function MmmPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-24 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 animate-pulse" />
          <div className="h-80 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 animate-pulse" />
        </div>
      }
    >
      <MmmContent />
    </Suspense>
  );
}

function MmmContent() {
  const { myBrandId, navigate, theme } = usePortal();
  const searchParams = useSearchParams();

  const [panelType, setPanelType] = useState<MmmPanelType>("conversions");
  const [mmmData, setMmmData] = useState<MmmResponse | null>(null);
  const [sliderSpend, setSliderSpend] = useState<Record<MmmChannelKey, number>>({
    own_spend_meta_usd: 20_000,
    own_spend_youtube_usd: 20_000,
    own_spend_tiktok_usd: 12_000,
    own_spend_display_usd: 10_000,
  });
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ladderOpen, setLadderOpen] = useState(false);
  const [chartsReady, setChartsReady] = useState(false);

  const latestRequestRef = useRef(0);

  useEffect(() => {
    setChartsReady(true);
  }, []);

  // Detect if user navigated here via a competitor ?brand_id= (case-insensitive canonical check)
  const requestedBrandParam = searchParams.get("brand_id");
  const normalizedParamBrand = requestedBrandParam
    ? toUiBrandId(requestedBrandParam)
    : null;
  const competitorLockNotice =
    normalizedParamBrand &&
    normalizedParamBrand !== "Unverified / Other" &&
    normalizedParamBrand !== myBrandId
      ? BRAND_CATALOG[normalizedParamBrand].name
      : null;

  useEffect(() => {
    const reqId = ++latestRequestRef.current;
    setLoading(true);
    setSimulating(false);
    setErrorMsg(null);
    getPortalMmm({
      brand_id: myBrandId,
      country: "Germany",
      panel_type: panelType,
    })
      .then((res) => {
        if (reqId !== latestRequestRef.current) return;
        setMmmData(res);
        setSliderSpend(buildInitialSpendMap(res));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (reqId !== latestRequestRef.current) return;
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Failed to load MMM response curves."
        );
        setLoading(false);
      });
    return () => {
      latestRequestRef.current += 1;
    };
  }, [myBrandId, panelType]);

  const activeChannelKeys = useMemo(
    () =>
      CHANNEL_KEYS.filter((k) => Boolean(mmmData?.channels?.[k])),
    [mmmData]
  );

  const totalProposedBudget = useMemo(
    () =>
      activeChannelKeys.reduce((acc, k) => acc + (sliderSpend[k] ?? 0), 0),
    [activeChannelKeys, sliderSpend]
  );

  const handleRunSimulation = async (optimize: boolean) => {
    if (!mmmData) return;
    const reqId = ++latestRequestRef.current;
    setSimulating(true);
    setErrorMsg(null);
    try {
      const targetBudget = optimize
        ? totalProposedBudget > 0
          ? totalProposedBudget
          : mmmData.simulation.baseline_total_spend_usd
        : totalProposedBudget;
      const res = await simulateMmm({
        brand_id: myBrandId,
        country: "Germany",
        total_budget_usd: targetBudget,
        proposed_spend_by_channel: sliderSpend,
        optimize,
        panel_type: panelType,
      });
      if (reqId !== latestRequestRef.current) return;
      setMmmData(res);
      const nextSpend = { ...sliderSpend };
      for (const row of res.simulation.channels) {
        nextSpend[row.channel_key] = Math.round(row.proposed_spend_usd);
      }
      setSliderSpend(nextSpend);
    } catch (err) {
      if (reqId !== latestRequestRef.current) return;
      setErrorMsg(
        err instanceof Error ? err.message : "MMM simulation failed."
      );
    } finally {
      if (reqId === latestRequestRef.current) {
        setSimulating(false);
      }
    }
  };

  const handleResetBaseline = async () => {
    if (!mmmData) return;
    const reqId = ++latestRequestRef.current;
    const base = buildInitialSpendMap(mmmData);
    setSliderSpend(base);
    setSimulating(true);
    setErrorMsg(null);
    try {
      const res = await simulateMmm({
        brand_id: myBrandId,
        country: "Germany",
        total_budget_usd: mmmData.simulation.baseline_total_spend_usd,
        proposed_spend_by_channel: base,
        optimize: false,
        panel_type: panelType,
      });
      if (reqId !== latestRequestRef.current) return;
      setMmmData(res);
    } catch (err) {
      if (reqId !== latestRequestRef.current) return;
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to reset MMM baseline."
      );
    } finally {
      if (reqId === latestRequestRef.current) {
        setSimulating(false);
      }
    }
  };

  // Build unified X-axis Hill curve series for Recharts LineChart
  const hillChartData = useMemo(() => {
    if (!mmmData || activeChannelKeys.length === 0) return [];
    const maxSpend = Math.max(
      ...activeChannelKeys.map((k) => mmmData.channels[k].max_spend_usd)
    );
    const steps = 16;
    const rows: Array<Record<string, number>> = [];
    for (let i = 0; i <= steps; i += 1) {
      const spend = Math.round((maxSpend * i) / steps);
      const point: Record<string, number> = { spend_usd: spend };
      for (const k of activeChannelKeys) {
        const ch = mmmData.channels[k];
        point[k] = Number(
          evaluateHillResponse(
            spend,
            ch.alpha,
            ch.half_saturation_k,
            ch.max_contribution
          ).toFixed(2)
        );
      }
      rows.push(point);
    }
    return rows;
  }, [mmmData, activeChannelKeys]);

  // Executive takeaway calculations
  const takeaway = useMemo(() => {
    if (!mmmData || mmmData.simulation.channels.length === 0) return null;
    const rows = mmmData.simulation.channels;
    const topMarginal = [...rows].sort(
      (a, b) => b.marginal_response_per_usd - a.marginal_response_per_usd
    )[0];
    const mostSaturated = [...rows].sort(
      (a, b) => b.saturation_pct - a.saturation_pct
    )[0];
    return {
      topMarginal,
      mostSaturated,
      liftPct: mmmData.simulation.expected_outcome_lift_pct,
    };
  }, [mmmData]);

  const selectedLadder = useMemo(() => {
    if (!mmmData || mmmData.ladder_comparison.length === 0) return null;
    return (
      mmmData.ladder_comparison.find((r) => r.selected) ??
      mmmData.ladder_comparison[mmmData.ladder_comparison.length - 1]
    );
  }, [mmmData]);

  const gridStroke = theme === "dark" ? "#27272a" : "#e4e4e7";
  const tickFill = theme === "dark" ? "#a1a1aa" : "#52525b";
  const myBrandName = BRAND_CATALOG[myBrandId].name;

  return (
    <div className="space-y-6">
      {/* Header + Outcome Panel Segmented Toggle */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Budget & ROI Planner — {myBrandName} (Germany 1st-Party)
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Bayesian Hill diminishing-returns simulator strictly calibrated to
            1st-party {myBrandName} Germany weekly media panels.
          </p>
        </div>

        {/* Conversions vs Google Trends Proxy Toggle */}
        <div
          role="group"
          aria-label="Outcome Panel Type"
          className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 p-1"
        >
          <button
            type="button"
            onClick={() => setPanelType("conversions")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              panelType === "conversions"
                ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            Conversions Outcome
          </button>
          <button
            type="button"
            onClick={() => setPanelType("google_trends_proxy")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              panelType === "google_trends_proxy"
                ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            Google Trends Proxy
          </button>
        </div>
      </div>

      {/* Strict 1st-Party Governance Lock Banner when navigated with competitor ?brand_id= */}
      {competitorLockNotice && (
        <div
          role="status"
          data-testid="competitor-governance-banner"
          className="rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-100/80 dark:bg-zinc-900 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs text-zinc-700 dark:text-zinc-300">
            <Lock className="h-4 w-4 mt-0.5 shrink-0 text-zinc-600 dark:text-zinc-400" />
            <div>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                1st-Party Governance Lock Active:
              </span>{" "}
              Competitor brand{" "}
              <span className="font-medium">{competitorLockNotice}</span> was
              requested via URL parameter, but Bayesian MMM budget allocation is
              strictly locked to your 1st-party brand (
              <span className="font-semibold">{myBrandName}</span>) because
              1st-party conversion panels are never calibrated on competitor
              spend.
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/mmm")}
            className="text-xs font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100 underline whitespace-nowrap"
          >
            Dismiss notice
          </button>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
        >
          {errorMsg}
        </div>
      )}

      {/* ROAS Claim Blocked Governance Banner (Google Trends Proxy Mode) */}
      {mmmData?.roas_claim_blocked && (
        <div
          role="alert"
          data-testid="roas-blocked-banner"
          className="rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/50 px-4 py-3.5 flex items-start gap-3"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="space-y-0.5">
            <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              ROAS Claim Blocked — Proxy Index Only
            </div>
            <p className="text-xs text-amber-800 dark:text-amber-300/90 leading-relaxed">
              {mmmData.disclaimer} All dollar ROI figures are replaced with{" "}
              <span className="font-mono font-medium">proxy_index_only</span>.
            </p>
          </div>
        </div>
      )}

      {loading && !mmmData && (
        <div className="space-y-4">
          <div className="h-24 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 animate-pulse" />
          <div className="h-72 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 animate-pulse" />
        </div>
      )}

      {/* Executive Takeaway Banner */}
      {mmmData && takeaway && (
        <section
          aria-label="Executive Takeaway"
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4 grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          <div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Top Marginal Channel
            </div>
            <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {takeaway.topMarginal.channel_label}
            </div>
            <div className="mt-0.5 text-xs font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {takeaway.topMarginal.marginal_response_per_usd.toFixed(2)} units
              / $1k marginal
            </div>
          </div>

          <div className="md:border-l md:border-zinc-200 dark:md:border-zinc-800 md:pl-4">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Most Saturated Channel
            </div>
            <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {takeaway.mostSaturated.channel_label}
            </div>
            <div className="mt-0.5 text-xs font-mono tabular-nums text-rose-700 dark:text-rose-400">
              {takeaway.mostSaturated.saturation_pct.toFixed(1)}% Hill
              saturation
            </div>
          </div>

          <div className="md:border-l md:border-zinc-200 dark:md:border-zinc-800 md:pl-4">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Expected Outcome Lift (
              {mmmData.roas_claim_blocked ? "Proxy Index" : "Conversions"})
            </div>
            <div
              data-testid="mmm-expected-lift"
              className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
                takeaway.liftPct > 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : takeaway.liftPct < 0
                    ? "text-rose-700 dark:text-rose-400"
                    : "text-zinc-900 dark:text-zinc-100"
              }`}
            >
              {takeaway.liftPct > 0 ? "+" : ""}
              {takeaway.liftPct.toFixed(2)}%
            </div>
            <div className="mt-0.5 text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
              {mmmData.simulation.baseline_total_contribution.toLocaleString()}{" "}
              →{" "}
              {mmmData.simulation.simulated_total_contribution.toLocaleString()}
            </div>
          </div>
        </section>
      )}

      {/* Sliders + Hill Diminishing-Returns Saturation Curves */}
      {mmmData && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Interactive Channel Budget Sliders */}
          <section className="xl:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Weekly Channel Budget Allocation
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 font-mono tabular-nums">
                  Proposed: {formatCurrency(totalProposedBudget, false)}/wk ·
                  Baseline:{" "}
                  {formatCurrency(
                    mmmData.simulation.baseline_total_spend_usd,
                    false
                  )}
                  /wk
                </p>
              </div>
              <button
                type="button"
                disabled={simulating}
                onClick={handleResetBaseline}
                aria-label="Reset sliders to baseline"
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset</span>
              </button>
            </div>

            <div className="space-y-4">
              {activeChannelKeys.map((key) => {
                const curve = mmmData.channels[key];
                const simRow = mmmData.simulation.channels.find(
                  (c) => c.channel_key === key
                );
                const val = sliderSpend[key] ?? curve.baseline_spend_usd;
                const delta = val - curve.baseline_spend_usd;
                return (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <label
                        htmlFor={`slider-${key}`}
                        className="flex items-center gap-2 font-medium text-zinc-800 dark:text-zinc-200"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: CHANNEL_COLORS[key] }}
                          aria-hidden="true"
                        />
                        <span>{curve.channel_label}</span>
                      </label>
                      <div className="flex items-center gap-2 font-mono tabular-nums">
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {formatCurrency(val, false)}
                        </span>
                        {Math.abs(delta) >= 50 && (
                          <span
                            className={`text-[11px] ${
                              delta > 0
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-rose-700 dark:text-rose-400"
                            }`}
                          >
                            {delta > 0 ? "+" : ""}
                            {formatCurrency(delta, true)}
                          </span>
                        )}
                      </div>
                    </div>

                    <input
                      id={`slider-${key}`}
                      type="range"
                      min={curve.min_spend_usd}
                      max={curve.max_spend_usd}
                      step={500}
                      value={Math.round(val)}
                      onChange={(e) =>
                        setSliderSpend((prev) => ({
                          ...prev,
                          [key]: Number(e.target.value),
                        }))
                      }
                      className="cis-slider w-full"
                    />

                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                      <span>
                        Base {formatCurrency(curve.baseline_spend_usd, false)}
                        /wk
                      </span>
                      <span>
                        Sat. {simRow ? `${simRow.saturation_pct.toFixed(1)}%` : "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={simulating}
                onClick={() => handleRunSimulation(false)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                <span>{simulating ? "Simulating..." : "Run What-If"}</span>
              </button>
              <button
                type="button"
                disabled={simulating}
                onClick={() => handleRunSimulation(true)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors whitespace-nowrap"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>
                  {simulating ? "Optimizing..." : "Auto-Optimize Split"}
                </span>
              </button>
            </div>
          </section>

          {/* Hill Diminishing-Returns Saturation Curves (Recharts LineChart) */}
          <section className="xl:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Hill Diminishing-Returns Saturation Curves
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Hollow circles mark baseline weekly spend; filled circles mark
                  proposed simulated spend on each channel curve.
                </p>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                {mmmData.roi_label}
              </span>
            </div>

            <div className="h-[340px] w-full">
              {chartsReady ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={hillChartData}
                    margin={{ top: 12, right: 20, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis
                      dataKey="spend_usd"
                      type="number"
                      domain={[0, "dataMax"]}
                      tickFormatter={(v) => formatCurrency(Number(v), true)}
                      tick={{ fill: tickFill, fontSize: 11 }}
                      axisLine={{ stroke: gridStroke }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: tickFill, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor:
                          theme === "dark" ? "#18181b" : "#ffffff",
                        borderColor:
                          theme === "dark" ? "#3f3f46" : "#e4e4e7",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      labelFormatter={(label) =>
                        `Weekly Spend: ${formatCurrency(Number(label), false)}`
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />

                    {activeChannelKeys.map((key) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={mmmData.channels[key].channel_label}
                        stroke={CHANNEL_COLORS[key]}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}

                    {/* Baseline & Proposed Spend Reference Markers */}
                    {mmmData.simulation.channels.map((row) => (
                      <React.Fragment key={row.channel_key}>
                        <ReferenceDot
                          x={row.baseline_spend_usd}
                          y={row.baseline_contribution}
                          r={5}
                          fill={theme === "dark" ? "#18181b" : "#ffffff"}
                          stroke={CHANNEL_COLORS[row.channel_key]}
                          strokeWidth={2}
                        />
                        <ReferenceDot
                          x={row.proposed_spend_usd}
                          y={row.proposed_contribution}
                          r={6}
                          fill={CHANNEL_COLORS[row.channel_key]}
                          stroke={theme === "dark" ? "#18181b" : "#ffffff"}
                          strokeWidth={2}
                        />
                      </React.Fragment>
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full w-full rounded-lg bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
              )}
            </div>
          </section>
        </div>
      )}

      {/* Full-Width Channel Reallocation Delta Table */}
      {mmmData && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Channel Reallocation Delta Table
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Baseline vs. simulated weekly spend, Hill curve saturation,
                marginal return, and posterior intervals.
              </p>
            </div>
            <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
              {mmmData.roas_claim_blocked
                ? "proxy_index_only"
                : "Conversions 90% HDI"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 text-zinc-500 dark:text-zinc-400">
                  <th className="py-2.5 px-5 font-medium">Channel</th>
                  <th className="py-2.5 px-4 font-medium text-right">
                    Baseline / wk
                  </th>
                  <th className="py-2.5 px-4 font-medium text-right">
                    Proposed / wk
                  </th>
                  <th className="py-2.5 px-4 font-medium text-right">Delta</th>
                  <th className="py-2.5 px-4 font-medium text-right">
                    Saturation %
                  </th>
                  <th className="py-2.5 px-4 font-medium text-right">
                    Marginal Response / $1k
                  </th>
                  <th className="py-2.5 px-5 font-medium text-right">
                    {mmmData.roas_claim_blocked
                      ? "proxy_index_only"
                      : "ROAS 90% HDI"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {mmmData.simulation.channels.map((row) => {
                  const satColor =
                    row.saturation_pct >= 72
                      ? "text-rose-700 dark:text-rose-400"
                      : row.saturation_pct >= 55
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-emerald-700 dark:text-emerald-400";

                  return (
                    <tr
                      key={row.channel_key}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    >
                      <td className="py-3 px-5 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-xs shrink-0"
                            style={{
                              backgroundColor: CHANNEL_COLORS[row.channel_key],
                            }}
                            aria-hidden="true"
                          />
                          <span>{row.channel_label}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {formatCurrency(row.baseline_spend_usd, false)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                        {formatCurrency(row.proposed_spend_usd, false)}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono tabular-nums ${
                          row.delta_spend_usd > 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : row.delta_spend_usd < 0
                              ? "text-rose-700 dark:text-rose-400"
                              : "text-zinc-500 dark:text-zinc-400"
                        }`}
                      >
                        {row.delta_spend_usd > 0 ? "+" : ""}
                        {formatCurrency(row.delta_spend_usd, true)}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono tabular-nums font-medium ${satColor}`}
                      >
                        {row.saturation_pct.toFixed(1)}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                        {row.marginal_response_per_usd.toFixed(2)}
                      </td>
                      <td className="py-3 px-5 text-right font-mono tabular-nums whitespace-nowrap text-zinc-800 dark:text-zinc-200">
                        {mmmData.roas_claim_blocked ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            proxy_index_only
                          </span>
                        ) : (
                          `${row.roas_mean.toFixed(2)}x (${row.roas_hdi_low.toFixed(1)}–${row.roas_hdi_high.toFixed(1)}x)`
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Creative Theme Attribution Bar Chart */}
      {mmmData && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Creative Theme Attribution
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Share of attributed outcome vs. spend share by creative theme (
                {myBrandName} Germany).
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-xs bg-zinc-400 dark:bg-zinc-500"
                  aria-hidden="true"
                />
                <span>Spend Share</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-xs bg-blue-600"
                  aria-hidden="true"
                />
                <span>Attributed Share</span>
              </span>
            </div>
          </div>

          <div className="h-[240px] w-full">
            {chartsReady ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={mmmData.theme_attribution}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 16, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={gridStroke}
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    unit="%"
                    tick={{ fill: tickFill, fontSize: 11 }}
                    axisLine={{ stroke: gridStroke }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="theme_label"
                    width={210}
                    tick={{ fill: tickFill, fontSize: 12 }}
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
                    formatter={(val: unknown, name: unknown) => [
                      `${Number(val).toFixed(1)}%`,
                      String(name),
                    ]}
                  />
                  <Bar
                    dataKey="spend_share_pct"
                    name="Spend Share"
                    fill={theme === "dark" ? "#71717a" : "#a1a1aa"}
                    radius={[0, 3, 3, 0]}
                    barSize={10}
                  />
                  <Bar
                    dataKey="contribution_share_pct"
                    name="Attributed Share"
                    fill="#2563eb"
                    radius={[0, 3, 3, 0]}
                    barSize={10}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full rounded-lg bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
            )}
          </div>
        </section>
      )}

      {/* Collapsible Model Ladder & Convergence Diagnostics Drawer */}
      {mmmData && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden">
          <button
            type="button"
            aria-expanded={ladderOpen}
            onClick={() => setLadderOpen((o) => !o)}
            className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/80 transition-colors"
          >
            <div>
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Model Ladder & Convergence Diagnostics
              </span>
              {selectedLadder && (
                <span className="ml-3 text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                  Selected: {selectedLadder.tier}
                  {selectedLadder.max_rhat != null
                    ? ` · max_rhat ${selectedLadder.max_rhat.toFixed(3)}`
                    : ""}
                  {selectedLadder.divergences != null
                    ? ` · ${selectedLadder.divergences} divergences`
                    : ""}
                </span>
              )}
            </div>
            {ladderOpen ? (
              <ChevronUp className="h-4 w-4 text-zinc-500" />
            ) : (
              <ChevronDown className="h-4 w-4 text-zinc-500" />
            )}
          </button>

          {ladderOpen && (
            <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">
                    <th className="py-2 pr-4 font-medium">Model Tier</th>
                    <th className="py-2 px-3 font-medium text-right">RMSE</th>
                    <th className="py-2 px-3 font-medium text-right">MAPE</th>
                    <th className="py-2 px-3 font-medium text-right">R²</th>
                    <th className="py-2 px-3 font-medium text-right">
                      max_rhat
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      min_ess
                    </th>
                    <th className="py-2 pl-3 font-medium text-right">
                      divergences
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                  {mmmData.ladder_comparison.map((row) => (
                    <tr
                      key={row.tier}
                      className={
                        row.selected ? "bg-zinc-50 dark:bg-zinc-800/40" : ""
                      }
                    >
                      <td className="py-2.5 pr-4">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          {row.label}
                        </div>
                        <div className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                          {row.tier}
                          {row.selected ? " · Active Production Model" : ""}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                        {row.rmse.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                        {row.mape.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                        {row.r2.toFixed(3)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                        {row.max_rhat !== null ? row.max_rhat.toFixed(3) : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                        {row.min_ess !== null
                          ? row.min_ess.toLocaleString()
                          : "—"}
                      </td>
                      <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                        {row.divergences !== null ? row.divergences : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
