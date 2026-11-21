"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { EU_AUTO_BRANDS, EuAutoBrand, usePortalContext } from "@/components/PortalProvider";
import {
  AuditSummary,
  CreativeItem,
  getPortalCreatives,
  submitHumanOverride,
} from "@/lib/api";

const BRAND_CHOICES = [...EU_AUTO_BRANDS, "Unverified / Other"];
const HOOK_OPTIONS = [
  { value: "", label: "All Opening Hooks" },
  { value: "offer_first", label: "Offer / Financing First (offer_first)" },
  { value: "product_demo", label: "Product Walkthrough (product_demo)" },
  { value: "brand_story", label: "Brand Heritage & Story (brand_story)" },
  { value: "ugc_testimonial", label: "Owner / Creator Proof (ugc_testimonial)" },
  { value: "problem_agitation", label: "Problem / Pain Point First (problem_agitation)" },
  { value: "unknown", label: "Unclassified Hook (unknown)" },
];

type EditableField = "matched_brand_id" | "theme_label" | "category";

function deriveCreativePlaybook(
  item: CreativeItem,
  myBrand: EuAutoBrand
): {
  badgeClass: string;
  badgeText: string;
  actionText: string;
} {
  if (
    item.belongs_to_brand === false ||
    (item.confidence !== null && item.confidence !== undefined && item.confidence < 0.7)
  ) {
    return {
      badgeClass: "badge-danger",
      badgeText: "Brand Match Review Needed",
      actionText:
        "Low AI brand confidence or unverified match \u2014 verify logo/badge in frame and save a human override below.",
    };
  }

  const effectiveBrand = item.matched_brand_id || item.evaluated_brand_id || "";
  const isCompetitor = Boolean(
    effectiveBrand && effectiveBrand !== myBrand && effectiveBrand !== "Unverified / Other"
  );

  if (isCompetitor) {
    if (item.is_fatigued) {
      return {
        badgeClass: "badge-warn",
        badgeText: "Competitor Fatigue Window",
        actionText: `Competitor (${effectiveBrand}) ad is decaying (${(
          (item.impression_decay_ratio ?? 0.5) * 100
        ).toFixed(0)}% of peak after ${item.active_weeks ?? 8}+ weeks) \u2014 capture share in "${
          item.theme_label || "core theme"
        }" while ${effectiveBrand} loses efficiency.`,
      };
    }
    if (item.theme_scope === "brand_exclusive_whitespace") {
      return {
        badgeClass: "badge-warn",
        badgeText: "Competitor Whitespace Angle",
        actionText: `${effectiveBrand} owns uncontested theme "${
          item.theme_label || "whitespace"
        }" (${item.hook_type || "n/a"} hook, ${
          item.time_to_brand_sec ?? "n/a"
        }s logo) \u2014 test a differentiated ${myBrand} counter-creative.`,
      };
    }
    return {
      badgeClass: "badge",
      badgeText: "Competitor Benchmark",
      actionText: `Benchmark ${effectiveBrand}'s ${item.hook_type || "n/a"} hook (format fit ${
        item.format_fit_score !== null && item.format_fit_score !== undefined
          ? `${item.format_fit_score.toFixed(0)}/100`
          : "n/a"
      }, CTA ${item.cta_clarity_score ?? "n/a"}/5) against ${myBrand}'s active rotation.`,
    };
  }

  if (item.is_fatigued) {
    return {
      badgeClass: "badge-danger",
      badgeText: "Refresh Opening Hook",
      actionText: `Running ${item.active_weeks ?? 8}+ weeks with impressions at ${(
        (item.impression_decay_ratio ?? 0.5) * 100
      ).toFixed(0)}% of peak \u2014 keep "${item.theme_label || "core theme"}" but re-cut the first 3 seconds (current hook: ${
        item.hook_type || "n/a"
      }, logo at ${item.time_to_brand_sec ?? "n/a"}s).`,
    };
  }
  if ((item.time_to_brand_sec ?? 0) > 3.5 || (item.cta_clarity_score ?? 5) <= 2) {
    return {
      badgeClass: "badge-warn",
      badgeText: "Tighten Branding & CTA",
      actionText: `Brand reveal (${item.time_to_brand_sec ?? "n/a"}s) or CTA clarity (${
        item.cta_clarity_score ?? "n/a"
      }/5) lags benchmark \u2014 move badge reveal under 2.5s and sharpen end-card offer copy.`,
    };
  }
  if (item.theme_scope === "brand_exclusive_whitespace" && (item.format_fit_score ?? 0) >= 75) {
    return {
      badgeClass: "badge-ok",
      badgeText: "Scale Whitespace Winner",
      actionText: `High format fit (${item.format_fit_score?.toFixed(0) ?? "80"}/100) in an uncontested theme ("${
        item.theme_label || "whitespace"
      }") \u2014 priority candidate for incremental ${myBrand} budget in Step 4.`,
    };
  }
  return {
    badgeClass: "badge-ok",
    badgeText: "Healthy Active Creative",
    actionText: `Format fit ${
      item.format_fit_score !== null && item.format_fit_score !== undefined
        ? `${item.format_fit_score.toFixed(0)}/100`
        : "n/a"
    } and CTA clarity ${
      item.cta_clarity_score !== null && item.cta_clarity_score !== undefined
        ? `${item.cta_clarity_score}/5`
        : "n/a"
    } \u2014 maintain ${myBrand} rotation and monitor weekly wearout.`,
  };
}

export default function CreativesLabPage() {
  return (
    <Suspense fallback={<p role="status">Loading ad creative review filters...</p>}>
      <CreativesLabContent />
    </Suspense>
  );
}

function CreativesLabContent() {
  const { myBrand } = usePortalContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlAssetId = searchParams.get("asset_id") ?? "";
  const urlBrandId = searchParams.get("brand_id") ?? "";

  const [assetFilter, setAssetFilter] = useState(urlAssetId);
  const [brandFilter, setBrandFilter] = useState(urlBrandId);
  const [hookFilter, setHookFilter] = useState("");
  const [onlyOverridden, setOnlyOverridden] = useState(false);

  const [items, setItems] = useState<CreativeItem[]>([]);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const latestRequestRef = useRef(0);

  useEffect(() => {
    setAssetFilter(urlAssetId);
  }, [urlAssetId]);

  useEffect(() => {
    setBrandFilter(urlBrandId);
  }, [urlBrandId]);

  async function refreshCreatives() {
    const reqId = ++latestRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getPortalCreatives({
        assetId: assetFilter || undefined,
        brandId: brandFilter || undefined,
        hookType: hookFilter || undefined,
        onlyOverridden,
        limit: 24,
      });
      if (reqId !== latestRequestRef.current) return;
      setItems(res.items);
      setAuditSummary(res.audit_summary);
    } catch (err) {
      if (reqId !== latestRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load creatives");
    } finally {
      if (reqId === latestRequestRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void refreshCreatives();
    return () => {
      latestRequestRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetFilter, brandFilter, hookFilter, onlyOverridden]);

  function clearAssetFilter() {
    setAssetFilter("");
    if (urlAssetId) {
      router.replace(
        brandFilter ? `/creatives?brand_id=${encodeURIComponent(brandFilter)}` : "/creatives",
        { scroll: false }
      );
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">3. Ad Creative Review &amp; Human Corrections</h1>
          <p className="page-subtitle">
            Inspect the video/image ads flagged in Step 2, review AI opening hooks and clarity scores, and save instant human corrections.
          </p>
        </div>

        <search>
          <form className="form-row" onSubmit={(e) => e.preventDefault()}>
            <div className="field">
              <label htmlFor="creative-asset">Ad ID</label>
              <input
                id="creative-asset"
                type="search"
                name="asset_id"
                value={assetFilter}
                onChange={(e) => setAssetFilter(e.target.value)}
                placeholder="Search exact or partial ID..."
              />
            </div>
            <div className="field">
              <label htmlFor="creative-brand">Brand</label>
              <select
                id="creative-brand"
                name="brand_id"
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
              >
                <option value="">All Brands (My Brand vs. Competitors)</option>
                {EU_AUTO_BRANDS.map((b) => (
                  <option key={b} value={b}>
                    {b} ({b === myBrand ? "My Brand" : "Competitor"})
                  </option>
                ))}
                <option value="Unverified / Other">Unverified / Other</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="creative-hook">Opening Hook</label>
              <select
                id="creative-hook"
                name="hook_type"
                value={hookFilter}
                onChange={(e) => setHookFilter(e.target.value)}
              >
                {HOOK_OPTIONS.map((h) => (
                  <option key={h.value || "all"} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="inline-check" htmlFor="creative-overridden">
              <input
                id="creative-overridden"
                type="checkbox"
                checked={onlyOverridden}
                onChange={(e) => setOnlyOverridden(e.target.checked)}
              />
              <span>Human-Edited Only</span>
            </label>
            <Link href="/mmm" className="btn">
              Step 4: {myBrand} Budget Planner &rarr;
            </Link>
          </form>
        </search>
      </div>

      {assetFilter && (
        <div className="banner banner-warn">
          <span aria-hidden="true">*</span>
          <span>
            Showing focused ad filter: <span className="id-pill">{assetFilter}</span>
          </span>
          <button type="button" className="btn" onClick={clearAssetFilter}>
            Show All Ads
          </button>
        </div>
      )}

      {auditSummary && (
        <section className="kpi-grid" aria-label="Human Review Progress">
          <article className="kpi-card">
            <p className="kpi-label">Total Tracked Ads</p>
            <p className="kpi-value">{auditSummary.total_assets}</p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Brand Match Verified</p>
            <p className="kpi-value">{auditSummary.verified_assets}</p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Manual Corrections Saved</p>
            <p className="kpi-value">{auditSummary.overridden_assets}</p>
          </article>
          <article className="kpi-card">
            <p className="kpi-label">Verified Coverage</p>
            <p className="kpi-value">{auditSummary.audit_coverage_pct.toFixed(1)}%</p>
          </article>
        </section>
      )}

      {statusMsg && (
        <div role="status" aria-live="polite" className="banner banner-ok">
          <span aria-hidden="true">&#10003;</span>
          <span>{statusMsg}</span>
        </div>
      )}

      {error && (
        <div role="alert" className="banner banner-danger">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      )}

      {loading && <p role="status">Loading ad creative cards...</p>}

      {!loading && items.length === 0 && (
        <div className="panel">
          <p className="page-subtitle" style={{ margin: 0 }}>
            No ads match the current filter combination.{" "}
            <button
              type="button"
              className="btn"
              onClick={() => {
                setAssetFilter("");
                setBrandFilter("");
                setHookFilter("");
                setOnlyOverridden(false);
                if (urlAssetId || urlBrandId) {
                  router.replace("/creatives", { scroll: false });
                }
              }}
            >
              Reset All Filters
            </button>
          </p>
        </div>
      )}

      <section className="card-grid" aria-label="Ad creative review cards">
        {items.map((item) => (
          <CreativeCard
            key={item.asset_id}
            item={item}
            myBrand={myBrand}
            onOverrideSaved={(updated, summary, latencyMs) => {
              setAuditSummary(summary);
              setStatusMsg(
                `Saved correction for #${item.short_asset_id || item.asset_id} in ${latencyMs.toFixed(1)} ms.`
              );
              if (updated) {
                setItems((prev) => prev.map((x) => (x.asset_id === updated.asset_id ? updated : x)));
              } else {
                void refreshCreatives();
              }
            }}
          />
        ))}
      </section>
    </>
  );
}

function CreativeCard({
  item,
  myBrand,
  onOverrideSaved,
}: {
  item: CreativeItem;
  myBrand: EuAutoBrand;
  onOverrideSaved: (
    updated: CreativeItem | undefined,
    summary: AuditSummary,
    latencyMs: number
  ) => void;
}) {
  const [fieldName, setFieldName] = useState<EditableField>("matched_brand_id");
  const [humanValue, setHumanValue] = useState(
    item.matched_brand_id || item.evaluated_brand_id || myBrand
  );
  const [reviewer, setReviewer] = useState("brand_marketer");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  function handleFieldChange(nextField: EditableField) {
    setFieldName(nextField);
    if (nextField === "matched_brand_id") {
      setHumanValue(item.matched_brand_id || item.evaluated_brand_id || myBrand);
    } else if (nextField === "theme_label") {
      setHumanValue(item.theme_label || "");
    } else {
      setHumanValue(item.category || "");
    }
  }

  async function handleOverride(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setCardError(null);
    const aiPrev =
      fieldName === "matched_brand_id"
        ? item.matched_brand_id
        : fieldName === "theme_label"
        ? item.theme_label
        : item.category;
    try {
      const resp = await submitHumanOverride({
        target_key_type: "asset_id",
        target_key_value: item.asset_id,
        field_name: fieldName,
        human_value: humanValue.trim(),
        reviewer: reviewer.trim() || "analyst",
        reason: reason.trim(),
        ai_value: aiPrev ?? undefined,
      });
      onOverrideSaved(resp.updated_items[0], resp.audit_summary, resp.latency_ms);
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Failed to save correction");
    } finally {
      setSaving(false);
    }
  }

  const playbook = deriveCreativePlaybook(item, myBrand);
  const resolvedBrand = item.matched_brand_id || item.evaluated_brand_id || "";
  const isMyBrand = resolvedBrand === myBrand && item.belongs_to_brand !== false;
  const isUnverified =
    item.belongs_to_brand === false || !resolvedBrand || resolvedBrand === "Unverified / Other";

  return (
    <article className="panel" aria-labelledby={`asset-${item.asset_id}`}>
      <img
        src={item.media_endpoint}
        alt={`Creative preview for ${item.asset_id} (${item.matched_brand_id || item.evaluated_brand_id || "unknown brand"})`}
        className="creative-media"
        loading="lazy"
      />
      <div style={{ marginBlockStart: "0.75rem" }}>
        <div className="form-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 id={`asset-${item.asset_id}`} className="panel-title" style={{ margin: 0 }}>
            <span className="id-pill" title={item.asset_id}>
              #{item.short_asset_id || item.asset_id}
            </span>
          </h2>
          <div className="form-row" style={{ gap: "0.35rem", alignItems: "center" }}>
            <span
              className={`badge ${
                isMyBrand ? "badge-ok" : isUnverified ? "badge-warn" : ""
              }`}
            >
              {isMyBrand ? "My Brand" : isUnverified ? "Unverified" : "Competitor"}
            </span>
            <span className={`badge ${item.has_human_override ? "badge-ok" : ""}`}>
              {item.has_human_override ? `Verified (${item.override_reviewer || "human"})` : "AI Tagging"}
            </span>
          </div>
        </div>

        <p className="kpi-note" style={{ marginBlockStart: "0.45rem" }}>
          <strong>Brand:</strong> {item.matched_brand_id || "Unverified / Other"} &middot;{" "}
          <strong>Approved Match:</strong> {item.belongs_to_brand ? "Yes" : "No"} &middot;{" "}
          <strong>Confidence:</strong> {item.confidence !== null && item.confidence !== undefined ? `${(item.confidence * 100).toFixed(0)}%` : "n/a"}
        </p>

        <p className="kpi-note">
          <strong>Theme:</strong> {item.theme_label || "Unclustered"} &middot;{" "}
          <strong>Opening Hook:</strong> {item.hook_type || "n/a"} ({item.time_to_brand_sec ?? "n/a"}s to logo)
        </p>

        <p className="kpi-note">
          <strong>Format Fit:</strong>{" "}
          {item.format_fit_score !== null && item.format_fit_score !== undefined
            ? `${item.format_fit_score.toFixed(0)}/100`
            : "n/a"}{" "}
          &middot; <strong>CTA Clarity:</strong>{" "}
          {item.cta_clarity_score !== null && item.cta_clarity_score !== undefined
            ? `${item.cta_clarity_score}/5`
            : "n/a"}
        </p>

        {item.hook_transcript && (
          <p className="kpi-note">&ldquo;{item.hook_transcript}&rdquo;</p>
        )}

        <div
          style={{
            marginBlockStart: "0.65rem",
            padding: "0.6rem 0.75rem",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            background: "var(--surface-alt)",
          }}
        >
          <div
            className="form-row"
            style={{ justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}
          >
            <strong style={{ fontSize: "0.82rem" }}>Recommended Marketer Action</strong>
            <span className={`badge ${playbook.badgeClass}`}>{playbook.badgeText}</span>
          </div>
          <p className="kpi-note" style={{ marginBlockStart: "0.3rem", color: "var(--text)" }}>
            {playbook.actionText}
          </p>
        </div>

        <form onSubmit={handleOverride} style={{ marginBlockStart: "0.75rem" }}>
          <div className="form-row">
            <div className="field">
              <label htmlFor={`field-select-${item.asset_id}`}>Field to Correct</label>
              <select
                id={`field-select-${item.asset_id}`}
                value={fieldName}
                onChange={(e) => handleFieldChange(e.target.value as EditableField)}
              >
                <option value="matched_brand_id">Brand Attribution</option>
                <option value="theme_label">Creative Theme Label</option>
                <option value="category">Vehicle / Ad Category</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`value-override-${item.asset_id}`}>Corrected Value</label>
              {fieldName === "matched_brand_id" ? (
                <select
                  id={`value-override-${item.asset_id}`}
                  name="human_value"
                  value={humanValue}
                  onChange={(e) => setHumanValue(e.target.value)}
                >
                  {BRAND_CHOICES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`value-override-${item.asset_id}`}
                  type="text"
                  name="human_value"
                  value={humanValue}
                  onChange={(e) => setHumanValue(e.target.value)}
                  placeholder="Enter corrected label..."
                  required
                />
              )}
            </div>
          </div>
          <div className="field" style={{ inlineSize: "100%", marginBlockStart: "0.5rem" }}>
            <label htmlFor={`reviewer-${item.asset_id}`}>Reviewer</label>
            <input
              id={`reviewer-${item.asset_id}`}
              type="text"
              name="reviewer"
              style={{ inlineSize: "100%" }}
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              required
            />
          </div>
          <div className="field" style={{ inlineSize: "100%", marginBlockStart: "0.5rem" }}>
            <label htmlFor={`reason-${item.asset_id}`}>Reason</label>
            <input
              id={`reason-${item.asset_id}`}
              type="text"
              name="reason"
              style={{ inlineSize: "100%" }}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Verified badge at 0.8s"
            />
          </div>
          {cardError && (
            <div role="alert" className="banner banner-danger" style={{ marginBlockStart: "0.5rem" }}>
              <span>{cardError}</span>
            </div>
          )}
          <div style={{ marginBlockStart: "0.6rem" }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving..." : "Save Correction"}
            </button>
          </div>
        </form>
      </div>
    </article>
  );
}
