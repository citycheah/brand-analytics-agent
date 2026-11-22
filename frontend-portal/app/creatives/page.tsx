"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  Download,
  Film,
  Image as ImageIcon,
  Layers,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { OverrideDrawer } from "@/components/OverrideDrawer";
import { usePortal } from "@/context/PortalContext";
import { classifyCreativePlaybook, formatCurrency } from "@/lib/analytics";
import { getMediaUrl, getPortalCreatives, toUiBrandId } from "@/lib/api";
import {
  BRAND_LIST,
  HOOK_TYPE_LABELS,
  type AuditSummary,
  type BrandFilterValue,
  type CreativeItem,
  type HookType,
  type OverrideResponse,
} from "@/lib/types";
import { downloadObjectsAsCsv } from "@/lib/utils";

type CreativesBrandFilter = BrandFilterValue | "Unverified / Other";

const HOOK_OPTIONS: Array<{ value: HookType | "all"; label: string }> = [
  { value: "all", label: "All Opening Hooks" },
  { value: "offer_first", label: "offer_first · Offer First" },
  { value: "product_demo", label: "product_demo · Product Demo" },
  { value: "brand_story", label: "brand_story · Brand Story" },
  { value: "ugc_testimonial", label: "ugc_testimonial · UGC Testimonial" },
  { value: "problem_agitation", label: "problem_agitation · Problem Agitation" },
  { value: "unknown", label: "unknown · Unknown" },
];

function MediaPreviewFrame({ item }: { item: CreativeItem }) {
  const [imgFailed, setImgFailed] = useState(false);
  const mediaSrc = getMediaUrl(item.asset_id, item.matched_brand_id);

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
      {!imgFailed ? (
        <img
          src={mediaSrc}
          alt={`${item.brand_name} ${item.theme_label} creative ${item.asset_id}`}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="h-full w-full flex flex-col items-center justify-center bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 px-4 text-center">
          {item.media_type === "video" ? (
            <Film className="h-7 w-7 mb-1.5 opacity-60" />
          ) : item.media_type === "carousel" ? (
            <Layers className="h-7 w-7 mb-1.5 opacity-60" />
          ) : (
            <ImageIcon className="h-7 w-7 mb-1.5 opacity-60" />
          )}
          <span className="text-xs font-mono">
            {`/api/v1/media/${item.short_asset_id}`}
          </span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3.5 py-2.5 flex items-center justify-between text-[11px] text-zinc-100 font-mono tabular-nums">
        <span>
          #{item.short_asset_id} · {item.channel}
        </span>
        <span className="uppercase">
          {item.media_type} · {item.aspect_ratio}
        </span>
      </div>
    </div>
  );
}

function parseUrlBrandFilter(raw: string | null): CreativesBrandFilter {
  if (!raw || !raw.trim()) return "all";
  if (raw.trim() === "Unverified / Other") return "Unverified / Other";
  const mapped = toUiBrandId(raw);
  return mapped === "Unverified / Other" ? "Unverified / Other" : mapped;
}

export default function CreativesPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-24 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 animate-pulse" />
          <div className="h-80 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 animate-pulse" />
        </div>
      }
    >
      <CreativesContent />
    </Suspense>
  );
}

function CreativesContent() {
  const { myBrandId, bumpAuditVersion } = usePortal();
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlAsset = searchParams.get("asset_id") ?? "";
  const urlBrand = searchParams.get("brand_id");

  const [assetQuery, setAssetQuery] = useState(urlAsset);
  const [brandFilter, setBrandFilter] = useState<CreativesBrandFilter>(() =>
    parseUrlBrandFilter(urlBrand)
  );
  const [hookFilter, setHookFilter] = useState<HookType | "all">("all");
  const [onlyOverridden, setOnlyOverridden] = useState(false);

  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [items, setItems] = useState<CreativeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [activeOverrideItem, setActiveOverrideItem] =
    useState<CreativeItem | null>(null);
  const [exported, setExported] = useState(false);

  const latestRequestRef = useRef(0);

  // Sync URL query params when navigated via deep-link
  useEffect(() => {
    setAssetQuery(urlAsset);
    setBrandFilter(parseUrlBrandFilter(urlBrand));
  }, [urlAsset, urlBrand]);

  const loadCreatives = useCallback(async () => {
    const reqId = ++latestRequestRef.current;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await getPortalCreatives({
        asset_id: assetQuery || undefined,
        brand_id: brandFilter,
        hook_type: hookFilter,
        only_overridden: onlyOverridden,
        limit: 24,
      });
      if (reqId !== latestRequestRef.current) return;
      setAuditSummary(res.audit_summary);
      setItems(res.items);
    } catch (err) {
      if (reqId !== latestRequestRef.current) return;
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to load creatives."
      );
    } finally {
      if (reqId === latestRequestRef.current) {
        setLoading(false);
      }
    }
  }, [assetQuery, brandFilter, hookFilter, onlyOverridden]);

  useEffect(() => {
    void loadCreatives();
    return () => {
      latestRequestRef.current += 1;
    };
  }, [loadCreatives]);

  const handleOverrideApplied = (res: OverrideResponse) => {
    setAuditSummary(res.audit_summary);
    setItems((prev) =>
      prev.map((c) =>
        c.asset_id === res.updated_item.asset_id ? res.updated_item : c
      )
    );
    const timing =
      res.latency_ms != null ? ` in ${res.latency_ms.toFixed(1)} ms` : "";
    setStatusMsg(
      `Saved human override for #${res.updated_item.short_asset_id}${timing}.`
    );
    bumpAuditVersion();
  };

  const clearAllFilters = () => {
    setAssetQuery("");
    setBrandFilter("all");
    setHookFilter("all");
    setOnlyOverridden(false);
    if (searchParams.toString()) {
      router.replace("/creatives", { scroll: false });
    }
  };

  const handleExportCreatives = () => {
    if (items.length === 0) return;
    const rows = items.map((r) => ({
      "Asset ID": r.asset_id,
      Brand: r.brand_name,
      Ownership:
        r.matched_brand_id === myBrandId
          ? "My Brand"
          : r.matched_brand_id === "Unverified / Other"
            ? "Unverified"
            : "Competitor",
      Category: r.category,
      Channel: r.channel,
      Market: r.country,
      "Media Type": r.media_type,
      "Aspect Ratio": r.aspect_ratio,
      Theme: r.theme_label,
      "Opening Hook": r.hook_type,
      Playbook: classifyCreativePlaybook(r, myBrandId).badge,
      "Hook Transcript": r.hook_transcript,
      "Time to Brand (s)": r.time_to_brand_sec.toFixed(1),
      "CTA Clarity (1-5)": r.cta_clarity_score,
      "Format Fit (0-100)": r.format_fit_score,
      "Wearout Score": r.wearout_score,
      "Decay (%)": r.decay_pct.toFixed(1),
      "Fatigue Status": r.fatigue_status,
      "Spend (USD)": r.spend_usd ?? "",
      Impressions: r.impressions ?? "",
      Verified: r.is_verified,
      Overridden: r.is_overridden,
      "Last Override Reviewer": r.last_override?.reviewer ?? "",
    }));
    const suffixParts = [
      brandFilter !== "all"
        ? brandFilter.toLowerCase().replace(/[^a-z0-9]+/g, "-")
        : "all-brands",
      hookFilter !== "all" ? hookFilter : null,
      onlyOverridden ? "overridden" : null,
    ].filter(Boolean);
    downloadObjectsAsCsv(`ad-creatives-${suffixParts.join("-")}.csv`, rows);
    setExported(true);
    window.setTimeout(() => setExported(false), 1800);
  };

  return (
    <div className="space-y-6">
      {/* Header + Audit Coverage Progress Bar */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Ad Creative Review & Human-in-the-Loop Audit
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Inspect opening hooks, branding speed, format fit, and fatigue
            decay. Override model classifications with full reviewer audit
            trail.
          </p>
        </div>

        <div
          className="w-full lg:w-[360px] shrink-0 space-y-2"
          data-testid="audit-coverage-bar"
        >
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Audit Coverage
            </span>
            <span className="font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
              {auditSummary
                ? `${auditSummary.audit_coverage_pct.toFixed(1)}%`
                : "—"}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-600 dark:bg-emerald-500 transition-[width] duration-300"
              style={{ width: `${auditSummary?.audit_coverage_pct ?? 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            <span>
              {auditSummary
                ? `${auditSummary.verified_assets} / ${auditSummary.total_assets} verified`
                : "Loading..."}
            </span>
            <span>
              {auditSummary
                ? `${auditSummary.overridden_assets} human overrides`
                : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Asset ID Search */}
        <div className="relative flex-1 min-w-[210px] max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <label htmlFor="creatives-asset-search" className="sr-only">
            Filter by asset ID
          </label>
          <input
            id="creatives-asset-search"
            type="text"
            value={assetQuery}
            onChange={(e) => setAssetQuery(e.target.value)}
            placeholder="Filter asset_id (exact or short suffix)..."
            className="w-full h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-8 pr-8 text-xs text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
          />
          {assetQuery && (
            <button
              type="button"
              onClick={() => setAssetQuery("")}
              aria-label="Clear asset filter"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Brand Filter */}
        <div className="flex items-center gap-2">
          <label htmlFor="creatives-brand-filter" className="sr-only">
            Brand Filter
          </label>
          <select
            id="creatives-brand-filter"
            value={brandFilter}
            onChange={(e) =>
              setBrandFilter(e.target.value as CreativesBrandFilter)
            }
            className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
          >
            <option value="all">All Brands</option>
            {BRAND_LIST.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.id === myBrandId ? "My Brand" : "Competitor"})
              </option>
            ))}
            <option value="Unverified / Other">Unverified / Other</option>
          </select>
        </div>

        {/* Canonical Opening Hook Filter */}
        <div className="flex items-center gap-2">
          <label htmlFor="creatives-hook-filter" className="sr-only">
            Opening Hook Filter
          </label>
          <select
            id="creatives-hook-filter"
            value={hookFilter}
            onChange={(e) => setHookFilter(e.target.value as HookType | "all")}
            className="h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
          >
            {HOOK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Overridden Only Toggle */}
        <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlyOverridden}
            onChange={(e) => setOnlyOverridden(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
          />
          <span>Overridden only</span>
        </label>

        {(assetQuery ||
          brandFilter !== "all" ||
          hookFilter !== "all" ||
          onlyOverridden) && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 underline"
          >
            Reset filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-3 shrink-0">
          <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            {items.length} {items.length === 1 ? "creative" : "creatives"}
          </span>
          <button
            type="button"
            onClick={handleExportCreatives}
            disabled={loading || items.length === 0}
            aria-label="Download CSV for Ad Creative Review"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
          >
            {exported ? (
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>{exported ? "Exported" : "Download CSV"}</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300 flex items-center justify-between gap-3"
        >
          <span>{statusMsg}</span>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="text-emerald-700 hover:underline dark:text-emerald-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
        >
          Failed to load creatives: {errorMsg}
        </div>
      )}

      {/* Creative Gallery Grid (2-3 columns) */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-[420px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-10 text-center space-y-3">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            No creatives match your active filters.
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Clear the asset search, opening hook filter, or overridden toggle to
            view all EU automotive creatives.
          </p>
          <button
            type="button"
            onClick={clearAllFilters}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div
          data-testid="creatives-gallery-grid"
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"
        >
          {items.map((item) => {
            const playbook = classifyCreativePlaybook(item, myBrandId);
            const playbookBadgeStyle =
              playbook.tone === "emerald"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300"
                : playbook.tone === "amber"
                  ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300"
                  : playbook.tone === "rose"
                    ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
                    : "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

            const fatigueTextClass =
              item.fatigue_status === "critical"
                ? "text-rose-700 dark:text-rose-400"
                : item.fatigue_status === "warning"
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-emerald-700 dark:text-emerald-400";

            const ownershipLabel =
              item.matched_brand_id === "Unverified / Other"
                ? "Unverified"
                : playbook.isOwnBrand
                  ? "My Brand"
                  : "Competitor";

            return (
              <article
                key={item.asset_id}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden flex flex-col justify-between"
              >
                <div>
                  <MediaPreviewFrame item={item} />

                  <div className="p-4 space-y-3">
                    {/* Brand + Ownership + Theme Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs flex-wrap">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {item.brand_name}
                          </span>
                          <span
                            aria-hidden="true"
                            className="text-zinc-300 dark:text-zinc-700"
                          >
                            ·
                          </span>
                          <span
                            className={
                              playbook.isOwnBrand
                                ? "font-medium text-blue-700 dark:text-blue-400"
                                : "text-zinc-500 dark:text-zinc-400"
                            }
                          >
                            {ownershipLabel}
                          </span>
                          {item.is_overridden && (
                            <>
                              <span
                                aria-hidden="true"
                                className="text-zinc-300 dark:text-zinc-700"
                              >
                                ·
                              </span>
                              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                Overridden
                              </span>
                            </>
                          )}
                        </div>
                        <h3 className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">
                          {item.theme_label}
                        </h3>
                        <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {item.category} · {item.country} ·{" "}
                          {HOOK_TYPE_LABELS[item.hook_type]}
                        </div>
                      </div>
                      <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                        {item.spend_usd != null
                          ? formatCurrency(item.spend_usd, true)
                          : item.confidence != null
                            ? `${Math.round(item.confidence * 100)}% conf.`
                            : ""}
                      </span>
                    </div>

                    {/* Tailored Playbook Badge & Action Callout */}
                    <div className="rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/60 p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${playbookBadgeStyle}`}
                        >
                          {playbook.badge}
                        </span>
                        <span
                          className={`text-[11px] font-mono tabular-nums font-medium ${fatigueTextClass}`}
                        >
                          {item.decay_pct.toFixed(1)}% decay
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                        {playbook.actionCallout}
                      </p>
                    </div>

                    {/* Hook Transcript */}
                    <div className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">
                        Hook:{" "}
                      </span>
                      {item.hook_transcript}
                    </div>

                    {/* Quantitative Creative Diagnostics */}
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs">
                      <div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          Brand Reveal
                        </div>
                        <div className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                          {item.time_to_brand_sec.toFixed(1)}s
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          CTA Clarity
                        </div>
                        <div className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                          {item.cta_clarity_score} / 5
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          Format Fit
                        </div>
                        <div className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                          {item.format_fit_score} / 100
                        </div>
                      </div>
                    </div>

                    {item.last_override && (
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 pt-1">
                        Last audit by{" "}
                        <span className="font-medium">
                          {item.last_override.reviewer}
                        </span>
                        :{" "}
                        {item.last_override.field_name === "audit_override"
                          ? "Human override recorded"
                          : `${item.last_override.field_name} → `}
                        {item.last_override.field_name !== "audit_override" && (
                          <span className="font-mono text-zinc-700 dark:text-zinc-300">
                            {item.last_override.human_value}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Action */}
                <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-2 bg-zinc-50/50 dark:bg-zinc-950/30">
                  <span className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                    Wearout {item.wearout_score}/100 ·{" "}
                    {item.is_verified ? "Verified" : "Unverified"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveOverrideItem(item)}
                    aria-label={`Review or override ${item.asset_id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                    <span>Review / Override</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Human-in-the-Loop Override Drawer */}
      <OverrideDrawer
        item={activeOverrideItem}
        onClose={() => setActiveOverrideItem(null)}
        onApplied={handleOverrideApplied}
      />
    </div>
  );
}
