"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { usePortal } from "@/context/PortalContext";
import {
  buildDecisionBrief,
  formatCompactNumber,
  formatCurrency,
  matchesBrandOrSubBrand,
} from "@/lib/analytics";
import { getPortalThemes, getPortalVelocity } from "@/lib/api";
import {
  BRAND_CATALOG,
  BRAND_LIST,
  COUNTRY_LIST,
  type BrandFilterValue,
  type CountryName,
  type PortalThemesResponse,
  type ScatterPointItem,
  type VelocityBreakoutItem,
} from "@/lib/types";
import { downloadObjectsAsCsv, slugify } from "@/lib/utils";

function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ScatterPointItem }>;
}) {
  if (!active || !payload || !payload.length) return null;
  const pt = payload[0].payload;
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2.5 shadow-md text-xs space-y-1 max-w-[240px]">
      <div className="font-semibold text-zinc-900 dark:text-zinc-100">
        {pt.brand_id_raw}
      </div>
      <div className="text-zinc-600 dark:text-zinc-300">{pt.theme_label}</div>
      <div className="flex items-center justify-between gap-4 pt-1 border-t border-zinc-100 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
        <span>#{pt.short_asset_id || pt.asset_id}</span>
        <span className="capitalize">{pt.media_type}</span>
      </div>
    </div>
  );
}

export default function ThemesPage() {
  const { myBrandId, navigate, theme, auditVersion } = usePortal();
  const [country, setCountry] = useState<CountryName>("Germany");
  const [brandFilter, setBrandFilter] = useState<BrandFilterValue>("all");
  const [themesData, setThemesData] = useState<PortalThemesResponse | null>(
    null
  );
  const [breakouts, setBreakouts] = useState<VelocityBreakoutItem[]>([]);
  const [activeThemeHighlight, setActiveThemeHighlight] = useState<
    string | null
  >(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [chartsReady, setChartsReady] = useState(false);
  const [exportedTable, setExportedTable] = useState<
    "sos" | "wearout" | "youtube" | null
  >(null);

  useEffect(() => {
    setChartsReady(true);
  }, []);

  const flashExported = (key: "sos" | "wearout" | "youtube") => {
    setExportedTable(key);
    window.setTimeout(() => {
      setExportedTable((curr) => (curr === key ? null : curr));
    }, 1800);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg(null);
    Promise.all([
      getPortalThemes({ country, brand_id: brandFilter }),
      getPortalVelocity({ top_k: 20, brand_id: brandFilter }).catch(() => ({
        breakout_queue: [] as VelocityBreakoutItem[],
      })),
    ])
      .then(([tRes, vRes]) => {
        if (!active) return;
        setThemesData(tRes);
        setBreakouts(vRes.breakout_queue);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Failed to load market & theme telemetry."
        );
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [country, brandFilter, auditVersion]);

  const decisionBrief = useMemo(() => {
    if (!themesData) return [];
    return buildDecisionBrief(themesData, myBrandId, brandFilter, breakouts);
  }, [themesData, myBrandId, brandFilter, breakouts]);

  const filteredBreakouts = useMemo(() => {
    return breakouts.filter((v) => matchesBrandOrSubBrand(v, brandFilter));
  }, [breakouts, brandFilter]);

  const scatterByTheme = useMemo(() => {
    if (!themesData) return [];
    const grouped = new Map<
      string,
      { color: string; points: ScatterPointItem[] }
    >();
    for (const t of themesData.themes_and_fatigue.themes) {
      grouped.set(t.theme_label, { color: t.color, points: [] });
    }
    for (const pt of themesData.themes_and_fatigue.scatter_points) {
      if (activeThemeHighlight && pt.theme_label !== activeThemeHighlight)
        continue;
      const entry = grouped.get(pt.theme_label) ?? {
        color: "#71717a",
        points: [],
      };
      entry.points.push(pt);
      grouped.set(pt.theme_label, entry);
    }
    return Array.from(grouped.entries()).filter(
      ([, g]) => g.points.length > 0
    );
  }, [themesData, activeThemeHighlight]);

  const scatterBounds = useMemo(() => {
    const pts = themesData?.themes_and_fatigue.scatter_points ?? [];
    if (pts.length === 0) {
      return {
        x: [-7, 7] as [number, number],
        y: [-7, 7] as [number, number],
      };
    }
    const xs = pts.map((p) => p.umap_x);
    const ys = pts.map((p) => p.umap_y);
    return {
      x: [Math.floor(Math.min(...xs) - 1), Math.ceil(Math.max(...xs) + 1)] as [
        number,
        number,
      ],
      y: [Math.floor(Math.min(...ys) - 1), Math.ceil(Math.max(...ys) + 1)] as [
        number,
        number,
      ],
    };
  }, [themesData]);

  const handleExportSosSov = () => {
    if (!themesData || themesData.sos_sov.brands.length === 0) return;
    const rows = themesData.sos_sov.brands.map((b) => ({
      Market: themesData.sos_sov.country_name,
      Brand: b.brand_name,
      Role: b.brand_id === myBrandId ? "My Brand" : "Competitor",
      "Ad Spend (USD)": b.spend_usd,
      Impressions: b.impressions,
      "SOS (%)": b.sos_pct.toFixed(1),
      "SOV (%)": b.sov_pct.toFixed(1),
      "SOV - SOS (pp)": b.efficiency_gap_pp.toFixed(1),
      "Active Creatives": b.active_creatives,
    }));
    downloadObjectsAsCsv(
      `market-share-sos-sov-${slugify(themesData.sos_sov.country_name)}.csv`,
      rows
    );
    flashExported("sos");
  };

  const handleExportWearout = () => {
    if (!themesData || themesData.themes_and_fatigue.fatigue_alerts.length === 0)
      return;
    const rows = themesData.themes_and_fatigue.fatigue_alerts.map((r) => ({
      Market: themesData.sos_sov.country_name,
      "Asset ID": r.asset_id,
      "Short ID": `#${r.short_asset_id}`,
      Brand: r.brand_name,
      Channel: r.channel,
      Theme: r.theme_label,
      "Active Weeks": r.active_weeks,
      "Peak Weekly Impressions": r.peak_weekly_impressions,
      "Recent Weekly Impressions": r.recent_weekly_impressions,
      "Decay (%)": r.decay_pct.toFixed(1),
      "Wearout Score": r.wearout_score,
      "Weekly Spend at Risk (USD)": r.weekly_spend_at_risk_usd,
      Status: r.status,
    }));
    downloadObjectsAsCsv(
      `creative-wearout-queue-${slugify(themesData.sos_sov.country_name)}-${brandFilter}.csv`,
      rows
    );
    flashExported("wearout");
  };

  const handleExportYoutube = () => {
    if (filteredBreakouts.length === 0) return;
    const rows = filteredBreakouts.map((r) => ({
      "Video ID": r.video_id,
      "Sub-Brand": r.sub_brand_label,
      Channel: r.channel_name,
      Title: r.title,
      Theme: r.theme_label,
      Market: r.country,
      "7d Views": r.views_7d,
      "Velocity Multiplier": r.velocity_multiplier.toFixed(1),
      "Breakout Probability (%)": Math.round(r.breakout_probability * 100),
      "Published Days Ago": r.published_days_ago,
      "Predicted Breakout": r.predicted_breakout,
    }));
    downloadObjectsAsCsv(`youtube-breakout-alerts-${brandFilter}.csv`, rows);
    flashExported("youtube");
  };

  const gridStroke = theme === "dark" ? "#27272a" : "#e4e4e7";
  const tickFill = theme === "dark" ? "#a1a1aa" : "#52525b";

  return (
    <div className="space-y-6">
      {/* Header & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Market Share & Creative Themes
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            EU automotive Share of Spend vs. Share of Voice, UMAP creative
            clusters, wearout queue, and YouTube breakouts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Market selector */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="themes-market-select"
              className="text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap"
            >
              Market
            </label>
            <select
              id="themes-market-select"
              value={country}
              onChange={(e) => setCountry(e.target.value as CountryName)}
              className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
            >
              {COUNTRY_LIST.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Brand Filter */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="themes-brand-select"
              className="text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap"
            >
              Brand Filter
            </label>
            <select
              id="themes-brand-select"
              value={brandFilter}
              onChange={(e) =>
                setBrandFilter(e.target.value as BrandFilterValue)
              }
              className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
            >
              <option value="all">All EU Auto Brands</option>
              {BRAND_LIST.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.id === myBrandId ? "My Brand" : "Competitor"})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
        >
          Failed to load themes data: {errorMsg}
        </div>
      )}

      {/* 3-Card Decision Brief */}
      <section
        aria-label="Decision Brief"
        className="grid grid-cols-1 lg:grid-cols-3 gap-4"
      >
        {loading && !themesData
          ? [0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-32 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 animate-pulse"
              />
            ))
          : decisionBrief.map((card) => {
              const metricColor =
                card.tone === "emerald"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : card.tone === "rose"
                    ? "text-rose-700 dark:text-rose-400"
                    : "text-amber-700 dark:text-amber-400";
              return (
                <div
                  key={card.id}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-zinc-500 dark:text-zinc-400">
                        {card.title}
                      </span>
                      <span
                        className={`font-mono font-medium tabular-nums ${metricColor}`}
                      >
                        {card.metricValue}
                      </span>
                    </div>
                    <div className="mt-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {card.headline}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {card.detail}
                    </p>
                  </div>
                  <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {card.metricLabel}
                  </div>
                </div>
              );
            })}
      </section>

      {/* SOS vs SOV Comparison Chart + Ranked Brand Table */}
      {themesData && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Share of Spend (SOS) vs. Share of Voice (SOV) —{" "}
                {themesData.sos_sov.country_name}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 font-mono tabular-nums">
                Total Spend{" "}
                {formatCurrency(themesData.sos_sov.total_spend_usd, true)} ·{" "}
                {formatCompactNumber(themesData.sos_sov.total_impressions)}{" "}
                impressions ·{" "}
                {themesData.sos_sov.audit_coverage_pct.toFixed(1)}% audit
                coverage
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleExportSosSov}
                disabled={themesData.sos_sov.brands.length === 0}
                aria-label="Download CSV for Market Share table"
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
              >
                {exportedTable === "sos" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>
                  {exportedTable === "sos" ? "Exported" : "Download CSV"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => navigate("/mmm")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors whitespace-nowrap shrink-0"
              >
                <span>Plan Budget</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            <div className="xl:col-span-5 space-y-2">
              <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-xs bg-zinc-600 dark:bg-zinc-400"
                    aria-hidden="true"
                  />
                  <span>Share of Spend (SOS)</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-xs bg-blue-600"
                    aria-hidden="true"
                  />
                  <span>Share of Voice (SOV)</span>
                </span>
              </div>
              <div className="h-[240px] w-full">
                {chartsReady ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={themesData.sos_sov.brands}
                      margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={gridStroke}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="brand_name"
                        tick={{ fill: tickFill, fontSize: 12 }}
                        axisLine={{ stroke: gridStroke }}
                        tickLine={false}
                      />
                      <YAxis
                        unit="%"
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
                        formatter={(val: unknown, name: unknown) => [
                          `${Number(val).toFixed(1)}%`,
                          String(name),
                        ]}
                      />
                      <Bar
                        dataKey="sos_pct"
                        name="Share of Spend (%)"
                        fill={theme === "dark" ? "#a1a1aa" : "#52525b"}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                      />
                      <Bar
                        dataKey="sov_pct"
                        name="Share of Voice (%)"
                        fill="#2563eb"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full w-full rounded-lg bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
                )}
              </div>
            </div>

            <div className="xl:col-span-7 overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">
                    <th className="py-2 pr-3 font-medium">Brand</th>
                    <th className="py-2 px-3 font-medium text-right">
                      Ad Spend
                    </th>
                    <th className="py-2 px-3 font-medium text-right">SOS %</th>
                    <th className="py-2 px-3 font-medium text-right">SOV %</th>
                    <th className="py-2 px-3 font-medium text-right">
                      SOV − SOS
                    </th>
                    <th className="py-2 pl-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                  {themesData.sos_sov.brands.map((row) => {
                    const isMine = row.brand_id === myBrandId;
                    const gapPositive = row.efficiency_gap_pp >= 0;
                    return (
                      <tr
                        key={row.brand_id}
                        className={
                          isMine
                            ? "bg-zinc-50 dark:bg-zinc-800/40"
                            : "hover:bg-zinc-50/70 dark:hover:bg-zinc-900/50"
                        }
                      >
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                              {row.brand_name}
                            </span>
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              {isMine ? "My Brand" : "Competitor"}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                          {formatCurrency(row.spend_usd, true)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                          {row.sos_pct.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                          {row.sov_pct.toFixed(1)}%
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono tabular-nums font-medium ${
                            gapPositive
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-rose-700 dark:text-rose-400"
                          }`}
                        >
                          {gapPositive ? "+" : ""}
                          {row.efficiency_gap_pp.toFixed(1)} pp
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          {isMine ? (
                            <button
                              type="button"
                              onClick={() => navigate("/mmm")}
                              className="font-medium text-zinc-900 hover:underline dark:text-zinc-100 whitespace-nowrap"
                            >
                              Plan Budget →
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/creatives?brand_id=${row.brand_id}`)
                              }
                              className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 whitespace-nowrap"
                            >
                              Inspect Ads →
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Interactive Creative Theme Map (Recharts ScatterChart) */}
      {themesData && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Creative Theme Map (UMAP Embedding)
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Hover any creative point for brand, theme, media format, and
                asset ID. Filter clusters below.
              </p>
            </div>
            {activeThemeHighlight && (
              <button
                type="button"
                onClick={() => setActiveThemeHighlight(null)}
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 underline"
              >
                Show all themes
              </button>
            )}
          </div>

          {/* Interactive Theme Filter Buttons */}
          <div className="flex flex-wrap gap-2">
            {themesData.themes_and_fatigue.themes.map((t) => {
              const selected = activeThemeHighlight === t.theme_label;
              return (
                <button
                  key={t.theme_id}
                  type="button"
                  onClick={() =>
                    setActiveThemeHighlight(selected ? null : t.theme_label)
                  }
                  className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                    selected
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700"
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: t.color }}
                    aria-hidden="true"
                  />
                  <span>{t.theme_label}</span>
                  <span className="font-mono text-[11px] opacity-75 tabular-nums">
                    {t.share_of_spend_pct.toFixed(0)}%
                  </span>
                </button>
              );
            })}
          </div>

          <div className="h-[310px] w-full">
            {chartsReady ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart
                  margin={{ top: 12, right: 18, bottom: 12, left: -8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis
                    type="number"
                    dataKey="umap_x"
                    name="UMAP X"
                    domain={scatterBounds.x}
                    tick={{ fill: tickFill, fontSize: 11 }}
                    axisLine={{ stroke: gridStroke }}
                    tickLine={false}
                  />
                  <YAxis
                    type="number"
                    dataKey="umap_y"
                    name="UMAP Y"
                    domain={scatterBounds.y}
                    tick={{ fill: tickFill, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ZAxis
                    type="number"
                    dataKey="spend_usd"
                    range={[55, 160]}
                    name="Creative"
                  />
                  <Tooltip
                    content={<ScatterTooltip />}
                    cursor={{ strokeDasharray: "3 3" }}
                  />
                  {scatterByTheme.map(([themeLabel, group]) => (
                    <Scatter
                      key={themeLabel}
                      name={themeLabel}
                      data={group.points}
                      fill={group.color}
                      fillOpacity={0.85}
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full rounded-lg bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
            )}
          </div>
        </section>
      )}

      {/* Full-Width Creative Wearout & Refresh Queue */}
      {themesData && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Creative Wearout & Refresh Queue
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Ranked by weekly impression decay and wearout score. Jump
                directly into creative review to inspect hooks or apply HITL
                overrides.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                {themesData.themes_and_fatigue.fatigue_alerts.length} ads in
                queue
              </span>
              <button
                type="button"
                onClick={handleExportWearout}
                disabled={
                  themesData.themes_and_fatigue.fatigue_alerts.length === 0
                }
                aria-label="Download CSV for Creative Wearout Queue"
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
              >
                {exportedTable === "wearout" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>
                  {exportedTable === "wearout" ? "Exported" : "Download CSV"}
                </span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 text-zinc-500 dark:text-zinc-400">
                  <th className="py-2.5 px-4 font-medium">Asset</th>
                  <th className="py-2.5 px-3 font-medium">Brand</th>
                  <th className="py-2.5 px-3 font-medium">Channel</th>
                  <th className="py-2.5 px-3 font-medium">Theme</th>
                  <th className="py-2.5 px-3 font-medium text-right">Weeks</th>
                  <th className="py-2.5 px-3 font-medium text-right">
                    Peak → Recent / wk
                  </th>
                  <th className="py-2.5 px-3 font-medium text-right">Decay</th>
                  <th className="py-2.5 px-3 font-medium text-right">
                    Wearout
                  </th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {themesData.themes_and_fatigue.fatigue_alerts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="py-8 text-center text-zinc-500 dark:text-zinc-400"
                    >
                      No fatigued creatives match the current brand filter.
                    </td>
                  </tr>
                ) : (
                  themesData.themes_and_fatigue.fatigue_alerts.map((row) => {
                    const statusStyle =
                      row.status === "critical"
                        ? "text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/50 dark:border-rose-900/60"
                        : row.status === "warning"
                          ? "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/50 dark:border-amber-900/60"
                          : "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/50 dark:border-emerald-900/60";
                    const statusLabel =
                      row.status === "critical"
                        ? "Critical"
                        : row.status === "warning"
                          ? "Warning"
                          : "Healthy";

                    return (
                      <tr
                        key={`${row.asset_id}-${row.channel}`}
                        className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                      >
                        <td className="py-2.5 px-4 font-mono tabular-nums text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                          #{row.short_asset_id}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                          {row.brand_name}
                        </td>
                        <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                          {row.channel}
                        </td>
                        <td className="py-2.5 px-3 text-zinc-700 dark:text-zinc-300 max-w-[220px] truncate">
                          {row.theme_label}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                          {row.active_weeks}w
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                          {formatCompactNumber(row.peak_weekly_impressions)} →{" "}
                          {formatCompactNumber(row.recent_weekly_impressions)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400 whitespace-nowrap">
                          {row.decay_pct.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                          {row.wearout_score}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusStyle}`}
                          >
                            {statusLabel}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `/creatives?brand_id=${row.brand_id}&asset_id=${encodeURIComponent(row.asset_id)}`
                              )
                            }
                            className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                          >
                            Review Ad →
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Organic YouTube Breakout Alerts */}
      <section
        id="youtube-momentum"
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Organic YouTube Breakout Alerts
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Includes OEM sub-brand channels (BMW M, BMW i, Mercedes-AMG,
              Mercedes-EQ, Audi Sport, Porsche Motorsport).
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
              {filteredBreakouts.length} matching signals
            </span>
            <button
              type="button"
              onClick={handleExportYoutube}
              disabled={filteredBreakouts.length === 0}
              aria-label="Download CSV for YouTube Breakout Alerts"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
            >
              {exportedTable === "youtube" ? (
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span>
                {exportedTable === "youtube" ? "Exported" : "Download CSV"}
              </span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 text-zinc-500 dark:text-zinc-400">
                <th className="py-2.5 px-4 font-medium">Sub-Brand / Channel</th>
                <th className="py-2.5 px-3 font-medium">Video Title</th>
                <th className="py-2.5 px-3 font-medium">Format</th>
                <th className="py-2.5 px-3 font-medium text-right">
                  30d Avg Views
                </th>
                <th className="py-2.5 px-3 font-medium text-right">
                  Signal / Thresh
                </th>
                <th className="py-2.5 px-4 font-medium text-right">
                  Breakout Prob.
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {filteredBreakouts.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-zinc-500 dark:text-zinc-400"
                  >
                    No YouTube breakout signals for the selected brand filter.
                  </td>
                </tr>
              ) : (
                filteredBreakouts.map((vid) => (
                  <tr
                    key={vid.video_id}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                  >
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {vid.sub_brand_label}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {vid.channel_name}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-zinc-800 dark:text-zinc-200 max-w-[340px]">
                      <div className="truncate font-medium">{vid.title}</div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {vid.country} · Published {vid.published_days_ago}d ago
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                      {vid.theme_label}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                      {formatCompactNumber(vid.views_7d)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-amber-700 dark:text-amber-400">
                      {vid.velocity_multiplier.toFixed(1)}x
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {Math.round(vid.breakout_probability * 100)}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Collapsible Technical Diagnostics Accordion */}
      {themesData && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden">
          <button
            type="button"
            aria-expanded={diagnosticsOpen}
            onClick={() => setDiagnosticsOpen((o) => !o)}
            className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/80 transition-colors"
          >
            <div>
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Technical Diagnostics
              </span>
              <span className="ml-3 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                Category HHI: {themesData.themes_and_fatigue.category_hhi} (
                {themesData.themes_and_fatigue.hhi_concentration}) · Pairwise
                Jaccard Overlap
              </span>
            </div>
            {diagnosticsOpen ? (
              <ChevronUp className="h-4 w-4 text-zinc-500" />
            ) : (
              <ChevronDown className="h-4 w-4 text-zinc-500" />
            )}
          </button>

          {diagnosticsOpen && (
            <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-4 space-y-2">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Herfindahl-Hirschman Index (Category HHI)
                </div>
                <div className="text-2xl font-semibold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                  {themesData.themes_and_fatigue.category_hhi}
                </div>
                <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  {themesData.themes_and_fatigue.hhi_concentration}
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  HHI above 2,500 signals high spend concentration among the top
                  two OEMs in {themesData.sos_sov.country_name}; whitespace
                  differentiation outperforms head-on spend escalation.
                </p>
              </div>

              <div className="lg:col-span-8 overflow-x-auto">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                  Jaccard Theme Overlap (Pairwise Brand Similarity)
                </div>
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">
                      <th className="py-1.5 pr-3 font-medium">Brand Pair</th>
                      <th className="py-1.5 px-3 font-medium text-right">
                        Jaccard
                      </th>
                      <th className="py-1.5 pl-3 font-medium">Shared Themes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                    {themesData.themes_and_fatigue.jaccard_overlaps.map((j) => (
                      <tr key={`${j.brand_a}-${j.brand_b}`}>
                        <td className="py-2 pr-3 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                          {BRAND_CATALOG[j.brand_a]?.name ?? j.brand_a} ×{" "}
                          {BRAND_CATALOG[j.brand_b]?.name ?? j.brand_b}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
                          {j.jaccard_index.toFixed(2)}
                        </td>
                        <td className="py-2 pl-3 text-zinc-500 dark:text-zinc-400">
                          {j.shared_themes.join(" · ") || "None"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
