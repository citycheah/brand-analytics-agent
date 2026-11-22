import { evaluateHillResponse } from './analytics';
import {
  BRAND_CATALOG,
  CHANNEL_LABELS,
  type AuditSummary,
  type BrandFilterValue,
  type BrandId,
  type BrandSosSov,
  type CopilotNextStepLink,
  type CountryName,
  type CreativeItem,
  type CreativesResponse,
  type FatigueAlertItem,
  type FinopsStageBreakdown,
  type HookType,
  type JaccardOverlapItem,
  type MmmChannelCurve,
  type MmmChannelKey,
  type MmmCurvePoint,
  type MmmLadderRow,
  type MmmPanelType,
  type MmmResponse,
  type MmmSimulationChannelRow,
  type MmmSimulationRequest,
  type MmmThemeAttributionRow,
  type OverridePayload,
  type OverrideResponse,
  type PortalOverviewResponse,
  type PortalThemesResponse,
  type PsiFeatureDriftItem,
  type ScatterPointItem,
  type ThemeSummaryItem,
  type VelocityBreakoutItem,
  type VelocityResponse,
} from './types';

// ============================================================================
// Brand, Scale & Theme Helpers
// ============================================================================

const BACKEND_BRAND_MAP: Record<BrandId, string> = {
  bmw: 'BMW',
  mercedes: 'Mercedes-Benz',
  audi: 'Audi',
  porsche: 'Porsche',
};

const VALID_HOOK_TYPES = new Set<HookType>([
  'offer_first',
  'product_demo',
  'brand_story',
  'ugc_testimonial',
  'problem_agitation',
  'unknown',
]);

const FALLBACK_COLORS = [
  '#2563eb',
  '#0f766e',
  '#d97706',
  '#be123c',
  '#7c3aed',
  '#0891b2',
  '#4f46e5',
  '#059669',
  '#b45309',
  '#e11d48',
];

export const THEME_PALETTE: Record<string, string> = {
  'EV Range & Charging Infrastructure': '#2563eb',
  '0% APR Flexible Lease Offer': '#d97706',
  'Autonomous & ADAS Safety Tech': '#7c3aed',
  'BMW Bespoke Cabin Craftsmanship': '#0f766e',
  'Mercedes-Benz Bespoke Cabin Craftsmanship': '#0891b2',
  'Audi Bespoke Cabin Craftsmanship': '#4f46e5',
  'Porsche Bespoke Cabin Craftsmanship': '#059669',
  'BMW Motorsport & Track Heritage': '#1d4ed8',
  'Mercedes-Benz Motorsport & Track Heritage': '#0d9488',
  'Audi Motorsport & Track Heritage': '#b45309',
  'Porsche Motorsport & Track Heritage': '#be123c',
};

export const AVAILABLE_THEMES = Object.keys(THEME_PALETTE);
export const AVAILABLE_CATEGORIES = [
  'EU Automotive',
  'EV Performance',
  'Executive Luxury',
  'Fleet & Leasing',
  'Autonomous Tech',
  'Sports Heritage',
  'Charging Infrastructure',
];

export function toBackendBrand(id: BrandId): string {
  return BACKEND_BRAND_MAP[id];
}

export function toUiBrandId(
  raw: string | null | undefined
): BrandId | 'Unverified / Other' {
  const val = String(raw ?? '').trim().toLowerCase();
  if (
    !val ||
    val === 'unverified' ||
    val === 'unverified / other' ||
    val === 'other' ||
    val === 'none' ||
    val === 'unknown'
  ) {
    return 'Unverified / Other';
  }
  if (val === 'bmw' || /\bbmw\b/.test(val)) return 'bmw';
  if (
    val === 'mercedes' ||
    val === 'mercedes-benz' ||
    /\b(mercedes|amg|maybach)\b/.test(val)
  ) {
    return 'mercedes';
  }
  if (val === 'audi' || /\baudi\b/.test(val)) return 'audi';
  if (val === 'porsche' || /\bporsche\b/.test(val)) return 'porsche';
  return 'Unverified / Other';
}

/**
 * Normalizes backend wearout scores (`0.0..1.0` float or `0..100` integer) onto `0..100`.
 */
export function normalizeWearoutPct(raw: number | null | undefined): number {
  if (raw == null || Number.isNaN(raw)) return 0;
  const scaled = raw <= 1.0 ? raw * 100 : raw;
  return Math.min(100, Math.max(0, Math.round(scaled)));
}

export function getThemeColor(label: string, idx = 0): string {
  if (THEME_PALETTE[label]) return THEME_PALETTE[label];
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_COLORS[(hash + idx) % FALLBACK_COLORS.length];
}

export function getMediaUrl(
  assetId: string,
  _brandHint?: BrandId | 'Unverified / Other'
): string {
  return `/api/v1/media/${encodeURIComponent(assetId)}`;
}

// ============================================================================
// Raw FastAPI Wire Shapes
// ============================================================================

export interface RawBrandSosSov {
  brand_id: string;
  total_spend_usd: number;
  total_impressions: number;
  sos_pct: number;
  sov_pct: number;
  audit_coverage_pct?: number;
  overridden_assets?: number;
  peak_creatives_per_month?: number;
}

export interface RawThemesResponse {
  sos_sov: {
    country_iso: string;
    country_name: string;
    total_spend_usd: number;
    total_impressions: number;
    audit_coverage_pct: number;
    brands: RawBrandSosSov[];
  };
  themes_and_fatigue: {
    category_hhi: number;
    hhi_concentration: string;
    themes: Array<{
      theme_id: string;
      theme_label: string;
      scope: string;
      participating_brands: number;
      brands: string[];
      spend_usd: number;
      impressions?: number;
      share_pct: number;
    }>;
    jaccard_overlaps: Array<{
      brand_a: string;
      brand_b: string;
      jaccard_similarity: number;
      shared_themes: string[];
    }>;
    scatter_points: Array<{
      asset_id?: string;
      theme_label?: string;
      brand_id_raw?: string;
      media_type?: string;
      umap_x?: number;
      umap_y?: number;
      x?: number;
      y?: number;
    }>;
    fatigue_alerts: Array<{
      asset_id: string;
      short_asset_id?: string;
      brand_id: string;
      focal_brand_id?: string;
      theme_label?: string;
      channel_group: string;
      active_weeks?: number;
      spend_usd?: number;
      peak_weekly_impressions?: number;
      recent_weekly_impressions?: number;
      impression_decay_ratio?: number;
      wearout_score?: number;
      is_fatigued?: boolean;
    }>;
  };
}

export interface RawCreativeItem {
  asset_id: string;
  short_asset_id?: string;
  brand_id_raw?: string;
  evaluated_brand_id?: string;
  matched_brand_id?: string | null;
  belongs_to_brand?: boolean | null;
  source_connector?: string | null;
  media_type?: string | null;
  aspect_ratio?: string | null;
  country_name?: string | null;
  category?: string | null;
  theme_label?: string | null;
  theme_scope?: string | null;
  hook_type?: string | null;
  hook_transcript?: string | null;
  time_to_brand_sec?: number | null;
  cta_clarity_score?: number | null;
  format_fit_score?: number | null;
  confidence?: number | null;
  wearout_score?: number | null;
  impression_decay_ratio?: number | null;
  is_fatigued?: boolean | null;
  has_human_override?: boolean | null;
  override_reviewer?: string | null;
  override_reason?: string | null;
  override_created_at?: string | null;
  ai_matched_brand_id?: string | null;
  ai_theme_label?: string | null;
  ai_category?: string | null;
}

export interface RawCreativesResponse {
  audit_summary: AuditSummary;
  items: RawCreativeItem[];
}

export interface RawOverrideResponse {
  status: string;
  latency_ms?: number;
  override?: Record<string, unknown>;
  updated_items: RawCreativeItem[];
  audit_summary: AuditSummary;
}

export interface RawMmmChannelCurve {
  baseline_weekly_spend_usd: number;
  beta: number;
  ec50_usd: number;
  slope: number;
  adstock_lambda?: number;
  roas_mean?: number;
  roas_hdi_90?: [number, number];
}

export interface RawMmmResponse {
  requested_scope?: { brand_id?: string; country_iso?: string };
  artifact_scope?: {
    brand_id?: string;
    country_iso?: string;
    used_fallback_scope?: boolean;
  };
  panel_type: string;
  is_proxy_outcome?: boolean;
  is_spend_modeled?: boolean;
  roas_claim_blocked: boolean;
  roi_label: string;
  disclaimer: string;
  channels: Record<string, RawMmmChannelCurve>;
  theme_attribution: Array<{
    theme_label: string;
    total_spend_usd?: number;
    spend_share_pct: number;
    incremental_per_1k_usd?: number;
    estimated_contribution: number;
    contribution_share_pct: number;
  }>;
  ladder_comparison: Array<{
    tier: string;
    rmse: number;
    mape_pct: number;
    r2: number;
    max_rhat?: number | null;
    min_ess?: number | null;
    divergences?: number | null;
    convergence_passed?: boolean;
  }>;
  simulation: {
    brand_id?: string;
    baseline_total_spend_usd: number;
    simulated_total_spend_usd: number;
    baseline_total_contribution: number;
    simulated_total_contribution: number;
    expected_outcome_lift_pct: number;
    channels: Array<{
      channel: string;
      baseline_weekly_spend_usd: number;
      simulated_weekly_spend_usd: number;
      spend_delta_usd: number;
      baseline_contribution: number;
      simulated_contribution: number;
      saturation_pct: number;
      marginal_response_per_usd: number;
      roas_mean?: number | null;
      roas_hdi_90?: [number, number] | null;
    }>;
  };
}

export interface RawVelocityResponse {
  total_scored_videos: number;
  predicted_breakouts: number;
  breakout_queue: Array<{
    video_id: string;
    brand_id?: string | null;
    channel_title: string;
    published_at?: string;
    title?: string;
    is_short?: boolean;
    breakout_prob: number;
    alert_threshold?: number;
    is_predicted_breakout?: boolean;
    channel_historical_avg_views_30d?: number;
  }>;
  drift_report?: {
    overall_status?: string;
    mean_psi?: number;
    max_psi?: number;
    alert_threshold?: number;
    total_features_monitored?: number;
    baseline_sample_size?: number;
    target_sample_size?: number;
    generated_at_utc?: string;
    feature_results?: Record<
      string,
      {
        feature_name: string;
        psi: number;
        status: string;
        baseline_distribution?: number[];
        target_distribution?: number[];
        bin_edges?: number[] | null;
      }
    >;
  };
  finops_summary?: {
    total_cost_usd?: number;
    total_estimated_cost_usd?: number;
    total_calls?: number;
    failed_calls?: number;
    by_stage?: Array<Record<string, unknown>>;
  };
  vision_eval?: {
    benchmark_name?: string;
    total_cases?: number;
    positive_cases?: number;
    negative_trap_cases?: number;
    manifest_present?: boolean;
    gates?: {
      min_brand_f1?: number;
      max_fpr?: number;
      min_hook_accuracy?: number;
    };
  };
}

export interface RawPortalOverview {
  market_highlight: {
    total_spend_usd: number;
    total_impressions: number;
    audit_coverage_pct: number;
  };
  theme_summary: {
    theme_count: number;
    fatigued_creative_count: number;
  };
  velocity_highlight: {
    predicted_breakouts: number;
  };
}

// ============================================================================
// Pure Wire-to-UI Adapters
// ============================================================================

function normalizeMediaType(raw: string | null | undefined): 'video' | 'image' | 'carousel' {
  const val = String(raw ?? '').toLowerCase();
  if (val === 'video' || val === 'carousel') return val;
  return 'image';
}

function prettifyChannelName(raw: string): string {
  const trimmed = raw.replace(/^own_spend_/, '').replace(/_usd$/, '');
  return trimmed
    .split('_')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function prettifyConnector(raw: string | null | undefined): string {
  const val = String(raw ?? '').toLowerCase();
  if (!val) return 'Lakehouse';
  if (val.includes('meta')) return 'Meta Ad Library';
  if (val.includes('youtube')) return 'YouTube';
  if (val.includes('tiktok')) return 'TikTok';
  if (val.includes('display')) return 'Display';
  return raw ?? 'Lakehouse';
}

function normalizeCountry(raw: string | null | undefined): CountryName {
  if (raw === 'United Kingdom' || raw === 'France' || raw === 'Germany') {
    return raw;
  }
  return 'Germany';
}

function computeWeightedMean(
  dist: number[] | undefined,
  edges: number[] | null | undefined
): number {
  if (!Array.isArray(dist) || !Array.isArray(edges) || edges.length !== dist.length + 1) {
    return 0;
  }
  let weighted = 0;
  let weightSum = 0;
  for (let i = 0; i < dist.length; i += 1) {
    const w = Number(dist[i] ?? 0);
    const mid = (Number(edges[i]) + Number(edges[i + 1])) / 2;
    if (Number.isFinite(w) && Number.isFinite(mid)) {
      weighted += w * mid;
      weightSum += w;
    }
  }
  return weightSum > 0 ? Number((weighted / weightSum).toFixed(2)) : 0;
}

export function adaptOverviewResponse(
  ov: RawPortalOverview,
  cr: RawCreativesResponse,
  th: RawThemesResponse,
  vel: RawVelocityResponse
): PortalOverviewResponse {
  const alerts = th.themes_and_fatigue?.fatigue_alerts ?? [];
  const wearoutSpendAtRiskUsd = alerts
    .filter((f) => Boolean(f.is_fatigued))
    .reduce(
      (acc, f) =>
        acc + Math.round((f.spend_usd ?? 0) / Math.max(1, f.active_weeks ?? 1)),
      0
    );

  const queue = vel.breakout_queue ?? [];
  const topBreakoutVelocityX = queue.reduce((best, v) => {
    const thresh = Math.max(0.05, v.alert_threshold || 0.2136);
    const mult = Number((v.breakout_prob / thresh).toFixed(1));
    return Math.max(best, mult);
  }, 0);

  const genAt = String(vel.drift_report?.generated_at_utc ?? '').slice(0, 10);

  return {
    germany_ad_spend_usd: ov.market_highlight?.total_spend_usd ?? 0,
    germany_ad_spend_impressions: ov.market_highlight?.total_impressions ?? 0,
    human_verified_accuracy_pct: ov.market_highlight?.audit_coverage_pct ?? 0,
    audit_coverage_pct: ov.market_highlight?.audit_coverage_pct ?? 0,
    verified_assets: cr.audit_summary?.verified_assets ?? 0,
    total_assets: cr.audit_summary?.total_assets ?? 0,
    active_themes_count: ov.theme_summary?.theme_count ?? 0,
    wearout_alerts_count: ov.theme_summary?.fatigued_creative_count ?? 0,
    wearout_spend_at_risk_usd: wearoutSpendAtRiskUsd,
    youtube_breakouts_count: ov.velocity_highlight?.predicted_breakouts ?? 0,
    top_breakout_velocity_x: topBreakoutVelocityX,
    as_of_date: genAt || 'Live Lakehouse',
  };
}

export function adaptThemesResponse(
  raw: RawThemesResponse,
  brandFilter: BrandFilterValue = 'all'
): PortalThemesResponse {
  const brands: BrandSosSov[] = [];
  for (const b of raw.sos_sov?.brands ?? []) {
    const uiBrand = toUiBrandId(b.brand_id);
    if (uiBrand === 'Unverified / Other') continue;
    brands.push({
      brand_id: uiBrand,
      brand_name: BRAND_CATALOG[uiBrand].name,
      spend_usd: b.total_spend_usd,
      impressions: b.total_impressions,
      sos_pct: b.sos_pct,
      sov_pct: b.sov_pct,
      efficiency_gap_pp: Number((b.sov_pct - b.sos_pct).toFixed(1)),
      active_creatives: b.peak_creatives_per_month ?? 0,
    });
  }

  const allScatter: ScatterPointItem[] = [];
  const countsByTheme = new Map<string, Record<BrandId, number>>();

  for (const pt of raw.themes_and_fatigue?.scatter_points ?? []) {
    const uiBrand = toUiBrandId(pt.brand_id_raw);
    if (uiBrand === 'Unverified / Other') continue;
    const themeLabel = pt.theme_label || 'Unclustered';
    const assetId = pt.asset_id ?? '';
    const item: ScatterPointItem = {
      asset_id: assetId,
      short_asset_id: assetId.length > 8 ? assetId.slice(-8) : assetId,
      brand_id: uiBrand,
      brand_id_raw: pt.brand_id_raw || BRAND_CATALOG[uiBrand].name,
      theme_label: themeLabel,
      media_type: normalizeMediaType(pt.media_type),
      umap_x: pt.umap_x ?? pt.x ?? 0,
      umap_y: pt.umap_y ?? pt.y ?? 0,
      spend_usd: 100,
      wearout_score: 0,
    };
    allScatter.push(item);

    const rec = countsByTheme.get(themeLabel) ?? {
      bmw: 0,
      mercedes: 0,
      audi: 0,
      porsche: 0,
    };
    rec[uiBrand] += 1;
    countsByTheme.set(themeLabel, rec);
  }

  const allFatigue: FatigueAlertItem[] = [];
  const wearoutsByTheme = new Map<string, number[]>();

  for (const f of raw.themes_and_fatigue?.fatigue_alerts ?? []) {
    const uiBrand = toUiBrandId(f.focal_brand_id || f.brand_id);
    if (uiBrand === 'Unverified / Other') continue;
    const wearoutScore = normalizeWearoutPct(f.wearout_score);
    const themeLabel = f.theme_label || 'Unclustered';
    const decayPct = Number((((f.impression_decay_ratio ?? 1) - 1) * 100).toFixed(1));
    const status: FatigueAlertItem['status'] = f.is_fatigued
      ? wearoutScore >= 70
        ? 'critical'
        : 'warning'
      : 'healthy';

    allFatigue.push({
      asset_id: f.asset_id,
      short_asset_id:
        f.short_asset_id || (f.asset_id.length > 8 ? f.asset_id.slice(-8) : f.asset_id),
      brand_id: uiBrand,
      brand_name: BRAND_CATALOG[uiBrand].name,
      channel: f.channel_group || 'Unknown',
      theme_label: themeLabel,
      active_weeks: f.active_weeks ?? 1,
      peak_weekly_impressions: f.peak_weekly_impressions ?? 0,
      recent_weekly_impressions: f.recent_weekly_impressions ?? 0,
      decay_pct: decayPct,
      wearout_score: wearoutScore,
      weekly_spend_at_risk_usd: Math.round(
        (f.spend_usd ?? 0) / Math.max(1, f.active_weeks ?? 1)
      ),
      status,
    });

    const list = wearoutsByTheme.get(themeLabel) ?? [];
    list.push(wearoutScore);
    wearoutsByTheme.set(themeLabel, list);
  }

  const themes: ThemeSummaryItem[] = (raw.themes_and_fatigue?.themes ?? []).map(
    (t, idx) => {
      const counts = {
        ...(countsByTheme.get(t.theme_label) ?? {
          bmw: 0,
          mercedes: 0,
          audi: 0,
          porsche: 0,
        }),
      };
      for (const rawBrand of t.brands ?? []) {
        const uiBrand = toUiBrandId(rawBrand);
        if (uiBrand !== 'Unverified / Other' && counts[uiBrand] < 1) {
          counts[uiBrand] = 1;
        }
      }
      const assetCount = Object.values(counts).reduce((a, b) => a + b, 0);
      const wearoutScores = wearoutsByTheme.get(t.theme_label) ?? [];
      const avgWearout =
        wearoutScores.length > 0
          ? Math.round(
              wearoutScores.reduce((a, b) => a + b, 0) / wearoutScores.length
            )
          : 0;
      const whitespaceScore =
        t.scope === 'brand_exclusive_whitespace'
          ? Math.min(98, Math.round(78 + (100 - t.share_pct) * 0.15))
          : Math.max(10, Math.round(65 - t.participating_brands * 12));

      return {
        theme_id: t.theme_id,
        theme_label: t.theme_label,
        asset_count: assetCount,
        total_spend_usd: t.spend_usd,
        share_of_spend_pct: t.share_pct,
        avg_wearout_score: avgWearout,
        brand_counts: counts,
        whitespace_score: whitespaceScore,
        color: getThemeColor(t.theme_label, idx),
      };
    }
  );

  const jaccardOverlaps: JaccardOverlapItem[] = [];
  for (const j of raw.themes_and_fatigue?.jaccard_overlaps ?? []) {
    const ba = toUiBrandId(j.brand_a);
    const bb = toUiBrandId(j.brand_b);
    if (ba === 'Unverified / Other' || bb === 'Unverified / Other') continue;
    jaccardOverlaps.push({
      brand_a: ba,
      brand_b: bb,
      jaccard_index: j.jaccard_similarity,
      shared_themes: j.shared_themes ?? [],
    });
  }

  const rawConc = raw.themes_and_fatigue?.hhi_concentration ?? 'Competitive';
  const hhiConcentration: PortalThemesResponse['themes_and_fatigue']['hhi_concentration'] =
    rawConc === 'High'
      ? 'Highly Concentrated'
      : rawConc === 'Moderate'
        ? 'Moderately Concentrated'
        : 'Competitive';

  const scopedScatter =
    brandFilter === 'all'
      ? allScatter
      : allScatter.filter((pt) => pt.brand_id === brandFilter);
  const scopedFatigue =
    brandFilter === 'all'
      ? allFatigue
      : allFatigue.filter((f) => f.brand_id === brandFilter);

  return {
    sos_sov: {
      country_iso: raw.sos_sov?.country_iso ?? 'DE',
      country_name: normalizeCountry(raw.sos_sov?.country_name),
      total_spend_usd: raw.sos_sov?.total_spend_usd ?? 0,
      total_impressions: raw.sos_sov?.total_impressions ?? 0,
      audit_coverage_pct: raw.sos_sov?.audit_coverage_pct ?? 0,
      brands,
    },
    themes_and_fatigue: {
      category_hhi: raw.themes_and_fatigue?.category_hhi ?? 0,
      hhi_concentration: hhiConcentration,
      themes,
      jaccard_overlaps: jaccardOverlaps,
      scatter_points: scopedScatter,
      fatigue_alerts: scopedFatigue,
    },
  };
}

export function adaptCreativeItem(
  raw: RawCreativeItem,
  overrideRecord?: Record<string, unknown>
): CreativeItem {
  const rawBrandCandidate =
    raw.matched_brand_id || raw.evaluated_brand_id || raw.brand_id_raw;
  const matchedBrandId: BrandId | 'Unverified / Other' =
    raw.belongs_to_brand === false
      ? 'Unverified / Other'
      : toUiBrandId(rawBrandCandidate);

  const brandName =
    matchedBrandId === 'Unverified / Other'
      ? 'Unverified / Other'
      : BRAND_CATALOG[matchedBrandId].name;

  const rawHook = String(raw.hook_type ?? 'unknown').toLowerCase() as HookType;
  const hookType: HookType = VALID_HOOK_TYPES.has(rawHook) ? rawHook : 'unknown';

  const wearoutScore = normalizeWearoutPct(raw.wearout_score);
  const decayPct =
    raw.impression_decay_ratio != null
      ? Number(((raw.impression_decay_ratio - 1) * 100).toFixed(1))
      : 0;
  const fatigueStatus: CreativeItem['fatigue_status'] = raw.is_fatigued
    ? wearoutScore >= 70
      ? 'critical'
      : 'warning'
    : 'healthy';

  const hasOverride = Boolean(raw.has_human_override || overrideRecord);
  let lastOverride: CreativeItem['last_override'];
  if (hasOverride) {
    const recField = overrideRecord?.field_name;
    let inferredField:
      | 'matched_brand_id'
      | 'theme_label'
      | 'category'
      | 'audit_override' = 'audit_override';
    let inferredAi = '';
    let inferredHuman = 'Verified by reviewer';

    if (
      recField === 'matched_brand_id' ||
      recField === 'theme_label' ||
      recField === 'category'
    ) {
      inferredField = recField;
      inferredAi = String(overrideRecord?.ai_value ?? '');
      inferredHuman = String(overrideRecord?.human_value ?? '');
    } else if (
      raw.theme_label &&
      raw.ai_theme_label &&
      raw.theme_label !== raw.ai_theme_label
    ) {
      inferredField = 'theme_label';
      inferredAi = raw.ai_theme_label;
      inferredHuman = raw.theme_label;
    } else if (
      raw.category &&
      raw.ai_category &&
      raw.category !== raw.ai_category
    ) {
      inferredField = 'category';
      inferredAi = raw.ai_category;
      inferredHuman = raw.category;
    } else if (
      raw.matched_brand_id &&
      raw.ai_matched_brand_id &&
      raw.matched_brand_id !== raw.ai_matched_brand_id
    ) {
      inferredField = 'matched_brand_id';
      inferredAi = raw.ai_matched_brand_id;
      inferredHuman = raw.matched_brand_id;
    }

    lastOverride = {
      field_name: inferredField,
      ai_value: inferredAi,
      human_value: inferredHuman,
      reviewer: String(
        overrideRecord?.reviewer ?? raw.override_reviewer ?? 'analyst'
      ),
      reason: String(
        overrideRecord?.reason ?? raw.override_reason ?? 'Verified in audit'
      ),
      updated_at: String(
        overrideRecord?.created_at ??
          raw.override_created_at ??
          new Date().toISOString()
      ),
    };
  }

  return {
    asset_id: raw.asset_id,
    short_asset_id:
      raw.short_asset_id ||
      (raw.asset_id.length > 8 ? raw.asset_id.slice(-8) : raw.asset_id),
    matched_brand_id: matchedBrandId,
    brand_name: brandName,
    category: raw.category || 'EU Automotive',
    channel: prettifyConnector(raw.source_connector),
    country: raw.country_name || 'Germany',
    media_type: normalizeMediaType(raw.media_type),
    aspect_ratio: raw.aspect_ratio || '16:9',
    theme_label: raw.theme_label || 'Unclustered',
    hook_type: hookType,
    hook_transcript: raw.hook_transcript || 'No opening hook transcript recorded.',
    time_to_brand_sec: Number(raw.time_to_brand_sec ?? 0),
    cta_clarity_score: Number(raw.cta_clarity_score ?? 0),
    format_fit_score: Math.round(Number(raw.format_fit_score ?? 0)),
    wearout_score: wearoutScore,
    decay_pct: decayPct,
    fatigue_status: fatigueStatus,
    whitespace_theme: raw.theme_scope === 'brand_exclusive_whitespace',
    spend_usd: null,
    impressions: null,
    confidence: raw.confidence ?? null,
    source_connector: raw.source_connector ?? null,
    is_verified: Boolean(raw.belongs_to_brand),
    is_overridden: hasOverride,
    last_override: lastOverride,
  };
}

export function adaptCreativesResponse(raw: RawCreativesResponse): CreativesResponse {
  return {
    audit_summary: raw.audit_summary,
    items: (raw.items ?? []).map((item) => adaptCreativeItem(item)),
  };
}

export function adaptOverrideResponse(raw: RawOverrideResponse): OverrideResponse {
  const first = raw.updated_items?.[0];
  if (!first) {
    throw new Error('Override applied, but backend returned no updated creative item.');
  }
  return {
    override_id: String(raw.override?.override_id ?? `ovr-${Date.now()}`),
    status: raw.status,
    latency_ms: raw.latency_ms,
    updated_item: adaptCreativeItem(first, raw.override),
    audit_summary: raw.audit_summary,
  };
}

const LADDER_LABELS: Record<string, string> = {
  tier1_spend_proportional: 'Tier 1 · Spend-Proportional Baseline',
  tier2_ridge_adstock_hill: 'Tier 2 · Ridge Adstock + Hill',
  tier3_bayesian_pymc_nutpie: 'Tier 3 · Bayesian PyMC + nutpie',
};

export function adaptMmmResponse(raw: RawMmmResponse): MmmResponse {
  const uiBrand = toUiBrandId(
    raw.artifact_scope?.brand_id ||
      raw.requested_scope?.brand_id ||
      raw.simulation?.brand_id
  );
  const brandId: BrandId = uiBrand === 'Unverified / Other' ? 'bmw' : uiBrand;
  const panelType: MmmPanelType =
    raw.panel_type === 'google_trends_proxy' ? 'google_trends_proxy' : 'conversions';

  const channelsOut = {} as Record<MmmChannelKey, MmmChannelCurve>;
  for (const [rawKey, ch] of Object.entries(raw.channels ?? {})) {
    const channelKey = rawKey as MmmChannelKey;
    const channelLabel = CHANNEL_LABELS[channelKey] ?? prettifyChannelName(rawKey);
    const baseline = Number(ch.baseline_weekly_spend_usd ?? 0);
    const ec50 = Number(ch.ec50_usd ?? 10_000);
    const slope = Number(ch.slope ?? 1.2);
    const beta = Number(ch.beta ?? 100);
    const maxSpend = Math.max(
      Math.round(baseline * 2.5),
      Math.round(ec50 * 2.2),
      50_000
    );

    const curvePoints: MmmCurvePoint[] = [];
    const steps = 16;
    for (let i = 0; i <= steps; i += 1) {
      const spend = Math.round((maxSpend * i) / steps);
      const exp = Number(evaluateHillResponse(spend, slope, ec50, beta).toFixed(2));
      curvePoints.push({
        spend_usd: spend,
        expected_contribution: exp,
        lower_hdi: Number((exp * 0.85).toFixed(2)),
        upper_hdi: Number((exp * 1.15).toFixed(2)),
      });
    }

    channelsOut[channelKey] = {
      channel_key: channelKey,
      channel_label: channelLabel,
      alpha: slope,
      half_saturation_k: ec50,
      max_contribution: beta,
      baseline_spend_usd: baseline,
      min_spend_usd: 0,
      max_spend_usd: maxSpend,
      curve_points: curvePoints,
    };
  }

  const simChannels: MmmSimulationChannelRow[] = (raw.simulation?.channels ?? []).map(
    (row) => {
      const channelKey = row.channel as MmmChannelKey;
      const baseSpend = Number(row.baseline_weekly_spend_usd ?? 0);
      const propSpend = Number(row.simulated_weekly_spend_usd ?? baseSpend);
      const deltaSpend = Number(row.spend_delta_usd ?? propSpend - baseSpend);
      const deltaPct =
        baseSpend > 0 ? Number(((deltaSpend / baseSpend) * 100).toFixed(1)) : 0;
      const hdi = row.roas_hdi_90 ?? [0, 0];

      return {
        channel_key: channelKey,
        channel_label:
          CHANNEL_LABELS[channelKey] ?? prettifyChannelName(row.channel),
        baseline_spend_usd: baseSpend,
        proposed_spend_usd: propSpend,
        delta_spend_usd: deltaSpend,
        delta_pct: deltaPct,
        saturation_pct: Number((row.saturation_pct ?? 0).toFixed(1)),
        // Backend exposes marginal response per $1; UI displays per $1k marginal
        marginal_response_per_usd: Number(
          ((row.marginal_response_per_usd ?? 0) * 1000).toFixed(2)
        ),
        roas_mean: Number((row.roas_mean ?? 0).toFixed(2)),
        roas_hdi_low: Number((hdi[0] ?? 0).toFixed(2)),
        roas_hdi_high: Number((hdi[1] ?? 0).toFixed(2)),
        baseline_contribution: Number((row.baseline_contribution ?? 0).toFixed(1)),
        proposed_contribution: Number((row.simulated_contribution ?? 0).toFixed(1)),
      };
    }
  );

  const themeAttribution: MmmThemeAttributionRow[] = (raw.theme_attribution ?? []).map(
    (t) => ({
      theme_label: t.theme_label,
      attributed_contribution: Number((t.estimated_contribution ?? 0).toFixed(1)),
      contribution_share_pct: Number((t.contribution_share_pct ?? 0).toFixed(1)),
      spend_share_pct: Number((t.spend_share_pct ?? 0).toFixed(1)),
      efficiency_index:
        t.spend_share_pct > 0
          ? Number((t.contribution_share_pct / t.spend_share_pct).toFixed(2))
          : 1.0,
    })
  );

  const ladderComparison: MmmLadderRow[] = (raw.ladder_comparison ?? []).map((row) => ({
    tier: row.tier,
    label: LADDER_LABELS[row.tier] ?? row.tier,
    rmse: Number((row.rmse ?? 0).toFixed(2)),
    mape: Number((row.mape_pct ?? 0).toFixed(2)),
    r2: Number((row.r2 ?? 0).toFixed(3)),
    max_rhat: row.max_rhat ?? null,
    min_ess: row.min_ess ?? null,
    divergences: row.divergences ?? null,
    convergence_passed: row.convergence_passed,
    selected: row.tier === 'tier3_bayesian_pymc_nutpie',
  }));

  return {
    brand_id: brandId,
    brand_name: BRAND_CATALOG[brandId].name,
    country: 'Germany',
    panel_type: panelType,
    artifact_scope: raw.artifact_scope,
    is_spend_modeled: raw.is_spend_modeled,
    roas_claim_blocked: Boolean(raw.roas_claim_blocked || raw.is_proxy_outcome),
    roi_label: raw.roi_label || 'incremental_roas',
    disclaimer: raw.disclaimer || '',
    channels: channelsOut,
    theme_attribution: themeAttribution,
    ladder_comparison: ladderComparison,
    simulation: {
      baseline_total_spend_usd: Number(
        (raw.simulation?.baseline_total_spend_usd ?? 0).toFixed(2)
      ),
      simulated_total_spend_usd: Number(
        (raw.simulation?.simulated_total_spend_usd ?? 0).toFixed(2)
      ),
      baseline_total_contribution: Number(
        (raw.simulation?.baseline_total_contribution ?? 0).toFixed(1)
      ),
      simulated_total_contribution: Number(
        (raw.simulation?.simulated_total_contribution ?? 0).toFixed(1)
      ),
      expected_outcome_lift_pct: Number(
        (raw.simulation?.expected_outcome_lift_pct ?? 0).toFixed(2)
      ),
      channels: simChannels,
    },
  };
}

export function adaptVelocityResponse(raw: RawVelocityResponse): VelocityResponse {
  const breakoutQueue: VelocityBreakoutItem[] = (raw.breakout_queue ?? []).map((v) => {
    const uiBrand = toUiBrandId(v.brand_id || v.channel_title);
    const threshold = Math.max(0.05, v.alert_threshold || 0.2136);
    const rawDate = String(v.published_at ?? '').trim().replace(' ', 'T');
    const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(rawDate);
    const parsedTs = rawDate
      ? Date.parse(hasTz ? rawDate : `${rawDate}Z`)
      : Number.NaN;
    const daysAgo = Number.isFinite(parsedTs)
      ? Math.max(0, Math.round((Date.now() - parsedTs) / 86_400_000))
      : 0;

    return {
      video_id: v.video_id,
      title: v.title || v.video_id,
      channel_name: v.channel_title,
      brand_id: uiBrand,
      sub_brand_label: v.channel_title,
      theme_label: v.is_short ? 'YouTube Shorts' : 'Long-Form Video',
      country: 'Germany',
      views_7d: Math.round(v.channel_historical_avg_views_30d ?? 0),
      velocity_multiplier: Number((v.breakout_prob / threshold).toFixed(1)),
      breakout_probability: v.breakout_prob,
      published_days_ago: daysAgo,
      predicted_breakout: Boolean(v.is_predicted_breakout),
    };
  });

  const drift = raw.drift_report ?? {};
  const baselineN = drift.baseline_sample_size ?? '?';
  const targetN = drift.target_sample_size ?? '?';
  const referenceWindow = `Baseline (N=${baselineN}) vs. Target (N=${targetN})`;

  const features: PsiFeatureDriftItem[] = Object.values(drift.feature_results ?? {})
    .map((fr) => ({
      feature_name: fr.feature_name,
      psi: Number(fr.psi ?? 0),
      baseline_mean: computeWeightedMean(fr.baseline_distribution, fr.bin_edges),
      current_mean: computeWeightedMean(fr.target_distribution, fr.bin_edges),
      status: (fr.status === 'drift_alert'
        ? 'alert'
        : fr.status === 'warning'
          ? 'warning'
          : 'ok') as PsiFeatureDriftItem['status'],
      window_label: referenceWindow,
    }))
    .sort((a, b) => b.psi - a.psi);

  const finops = raw.finops_summary ?? {};
  const stages: FinopsStageBreakdown[] = (finops.by_stage ?? []).map((st) => ({
    stage: String(st.stage ?? 'unknown'),
    model: String(st.sku ?? st.model ?? 'gemini'),
    calls: Number(st.calls ?? 0),
    failed_calls: Number(st.failed_calls ?? 0),
    cost_usd: Number(st.cost_usd ?? 0),
    avg_latency_ms: Number(st.avg_latency_ms ?? 0),
  }));

  const evalRaw = raw.vision_eval ?? {};
  const gatesRaw = evalRaw.gates ?? {};
  const manifestPresent = Boolean(evalRaw.manifest_present);

  return {
    total_scored_videos: raw.total_scored_videos ?? 0,
    predicted_breakouts: raw.predicted_breakouts ?? 0,
    breakout_queue: breakoutQueue,
    drift_report: {
      evaluated_at: String(drift.generated_at_utc ?? ''),
      reference_window: referenceWindow,
      overall_status: drift.overall_status,
      mean_psi: drift.mean_psi,
      max_psi: drift.max_psi,
      alert_threshold: drift.alert_threshold,
      total_features_monitored: drift.total_features_monitored,
      features,
    },
    finops_summary: {
      period_label: 'Cumulative Lakehouse Ledger',
      total_cost_usd: Number(
        finops.total_estimated_cost_usd ?? finops.total_cost_usd ?? 0
      ),
      total_calls: Number(finops.total_calls ?? 0),
      failed_calls: Number(finops.failed_calls ?? 0),
      budget_cap_usd: 5.0,
      stages,
    },
    vision_eval: {
      dataset_name: evalRaw.benchmark_name ?? 'Golden Vision Eval',
      evaluated_samples: Number(evalRaw.total_cases ?? 0),
      positive_cases: Number(evalRaw.positive_cases ?? 0),
      negative_trap_cases: Number(evalRaw.negative_trap_cases ?? 0),
      manifest_present: manifestPresent,
      all_passed: manifestPresent,
      gates: [
        {
          metric_key: 'min_brand_f1',
          label: 'Brand Attribution F1 Gate',
          actual: null,
          threshold: Number(gatesRaw.min_brand_f1 ?? 0.85),
          operator: '>=',
          passed: null,
        },
        {
          metric_key: 'max_fpr',
          label: 'Negative-Trap False Positive Rate',
          actual: null,
          threshold: Number(gatesRaw.max_fpr ?? 0.15),
          operator: '<=',
          passed: null,
        },
        {
          metric_key: 'min_hook_accuracy',
          label: 'Opening Hook Classification Accuracy',
          actual: null,
          threshold: Number(gatesRaw.min_hook_accuracy ?? 0.8),
          operator: '>=',
          passed: null,
        },
      ],
    },
  };
}

// ============================================================================
// HTTP Client & Live FastAPI Endpoints
// ============================================================================

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function getPortalOverview(): Promise<PortalOverviewResponse> {
  const [ov, cr, th, vel] = await Promise.all([
    fetchJson<RawPortalOverview>('/api/v1/portal/overview'),
    fetchJson<RawCreativesResponse>('/api/v1/portal/creatives?limit=1'),
    fetchJson<RawThemesResponse>('/api/v1/portal/themes?country=Germany'),
    fetchJson<RawVelocityResponse>('/api/v1/portal/velocity?top_k=5'),
  ]);
  return adaptOverviewResponse(ov, cr, th, vel);
}

export async function getPortalThemes(params: {
  country: CountryName;
  brand_id: BrandFilterValue;
}): Promise<PortalThemesResponse> {
  const qs = new URLSearchParams({ country: params.country });
  if (params.brand_id && params.brand_id !== 'all') {
    qs.set('brand_id', toBackendBrand(params.brand_id));
  }
  const raw = await fetchJson<RawThemesResponse>(
    `/api/v1/portal/themes?${qs.toString()}`
  );
  return adaptThemesResponse(raw, params.brand_id);
}

export async function getPortalCreatives(params: {
  asset_id?: string;
  brand_id?: BrandFilterValue | 'Unverified / Other';
  hook_type?: HookType | 'all';
  only_overridden?: boolean;
  limit?: number;
}): Promise<CreativesResponse> {
  const qs = new URLSearchParams();
  if (params.asset_id?.trim()) qs.set('asset_id', params.asset_id.trim());
  if (params.brand_id && params.brand_id !== 'all') {
    qs.set(
      'brand_id',
      params.brand_id === 'Unverified / Other'
        ? 'Unverified / Other'
        : toBackendBrand(params.brand_id)
    );
  }
  if (params.hook_type && params.hook_type !== 'all') {
    qs.set('hook_type', params.hook_type);
  }
  if (params.only_overridden) {
    qs.set('only_overridden', 'true');
  }
  qs.set('limit', String(params.limit ?? 24));

  const raw = await fetchJson<RawCreativesResponse>(
    `/api/v1/portal/creatives?${qs.toString()}`
  );
  return adaptCreativesResponse(raw);
}

export async function postOverride(payload: OverridePayload): Promise<OverrideResponse> {
  const normalizeOverrideBrand = (value: string): string => {
    if (payload.field_name !== 'matched_brand_id') return value;
    const trimmed = value.trim();
    if (trimmed === 'Unverified / Other') return trimmed;
    const uiBrand = toUiBrandId(trimmed);
    return uiBrand === 'Unverified / Other' ? trimmed : toBackendBrand(uiBrand);
  };

  const wirePayload = {
    target_key_type: payload.target_key_type,
    target_key_value: payload.target_key_value,
    field_name: payload.field_name,
    human_value: normalizeOverrideBrand(payload.human_value),
    reviewer: payload.reviewer,
    reason: payload.reason,
    ai_value: payload.ai_value ? normalizeOverrideBrand(payload.ai_value) : undefined,
  };

  const raw = await fetchJson<RawOverrideResponse>('/api/v1/overrides', {
    method: 'POST',
    body: JSON.stringify(wirePayload),
  });

  if (raw.updated_items && raw.updated_items.length > 0) {
    return adaptOverrideResponse(raw);
  }

  const single = await getPortalCreatives({
    asset_id: payload.target_key_value,
    limit: 1,
  });
  const matched = single.items[0];
  if (!matched) {
    throw new Error('Override saved, but creative item could not be reloaded.');
  }
  return {
    override_id: String(raw.override?.override_id ?? `ovr-${Date.now()}`),
    status: raw.status,
    latency_ms: raw.latency_ms,
    updated_item: matched,
    audit_summary: single.audit_summary,
  };
}

export async function getPortalMmm(params: {
  brand_id: BrandId;
  country: string;
  panel_type: MmmPanelType;
}): Promise<MmmResponse> {
  const qs = new URLSearchParams({
    brand_id: toBackendBrand(params.brand_id),
    country: params.country,
    panel_type: params.panel_type,
  });
  const raw = await fetchJson<RawMmmResponse>(`/api/v1/portal/mmm?${qs.toString()}`);
  return adaptMmmResponse(raw);
}

export async function simulateMmm(
  request: MmmSimulationRequest
): Promise<MmmResponse> {
  const body = request.optimize
    ? {
        brand_id: toBackendBrand(request.brand_id),
        country: request.country,
        total_budget_usd: request.total_budget_usd,
        optimize: true,
        panel_type: request.panel_type,
      }
    : {
        brand_id: toBackendBrand(request.brand_id),
        country: request.country,
        proposed_spend_by_channel: request.proposed_spend_by_channel,
        optimize: false,
        panel_type: request.panel_type,
      };

  const raw = await fetchJson<RawMmmResponse>('/api/v1/mmm/simulate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return adaptMmmResponse(raw);
}

export async function getPortalVelocity(params: {
  top_k?: number;
  brand_id?: BrandFilterValue;
}): Promise<VelocityResponse> {
  const qs = new URLSearchParams({ top_k: String(params.top_k ?? 15) });
  if (params.brand_id && params.brand_id !== 'all') {
    qs.set('brand_id', toBackendBrand(params.brand_id));
  }
  const raw = await fetchJson<RawVelocityResponse>(
    `/api/v1/portal/velocity?${qs.toString()}`
  );
  return adaptVelocityResponse(raw);
}

// ============================================================================
// Executive Copilot SSE Streaming & Deep-Link Helpers
// ============================================================================

export function buildCopilotSuggestedPrompts(myBrandId: BrandId): string[] {
  const name = BRAND_CATALOG[myBrandId].name;
  return [
    `Compare ${name} share of spend vs. share of voice against top German rivals, and surface uncontested themes.`,
    `Audit ${name}'s highest-wearout Germany ads and recommend immediate opening hook fixes.`,
    `If we hold Germany weekly budget flat for ${name}, how much conversion lift comes from shifting Display into YouTube & TikTok?`,
    `Summarize this week's EU Auto YouTube breakouts for ${name} sub-brands and key competitors.`,
  ];
}

function extractAdkText(payload: Record<string, unknown>): string {
  const content = payload.content as { parts?: Array<{ text?: string }> } | undefined;
  if (content?.parts && Array.isArray(content.parts)) {
    const texts = content.parts
      .map((p) => p.text)
      .filter((t): t is string => Boolean(t));
    if (texts.length > 0) return texts.join('\n');
  }
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.output === 'string') return payload.output;
  if (typeof payload.message === 'string') return payload.message;
  return '';
}

function deriveNextSteps(
  text: string,
  myBrandId: BrandId
): CopilotNextStepLink[] {
  const lower = text.toLowerCase();
  const brand = BRAND_CATALOG[myBrandId].name;
  const links: CopilotNextStepLink[] = [];
  const add = (link: CopilotNextStepLink) => {
    if (!links.some((l) => l.path === link.path)) links.push(link);
  };

  if (/fatigue|wearout|decay|theme|whitespace|sos|sov|share/.test(lower)) {
    add({ label: 'Explore Market Share & Themes', path: '/themes', step: 2 });
    add({
      label: `Review ${brand} Creatives`,
      path: `/creatives?brand_id=${myBrandId}`,
      step: 3,
    });
  }
  if (/budget|roas|roi|channel|spend|mmm|saturat|hill|lift/.test(lower)) {
    add({ label: `Simulate ${brand} Budget Split`, path: '/mmm', step: 4 });
  }
  if (/youtube|breakout|velocity|organic/.test(lower)) {
    add({
      label: 'View YouTube Breakouts',
      path: '/themes#youtube-momentum',
      step: 2,
    });
  }
  if (links.length === 0) {
    add({ label: 'Explore Market Share & Themes', path: '/themes', step: 2 });
    add({
      label: `Review ${brand} Creatives`,
      path: `/creatives?brand_id=${myBrandId}`,
      step: 3,
    });
    add({ label: `Open ${brand} Budget & ROI Planner`, path: '/mmm', step: 4 });
  }
  return links;
}

export async function streamCopilotQuery(params: {
  message: string;
  user_id: string;
  session_id: string;
  my_brand_id: BrandId;
  onChunk: (textDelta: string) => void;
  signal?: AbortSignal;
}): Promise<{ nextSteps: CopilotNextStepLink[] }> {
  const response = await fetch('/query/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: params.message,
      user_id: params.user_id,
      session_id: params.session_id,
    }),
    signal: params.signal,
  });

  if (response.status === 409) {
    const body = await response.json().catch(() => ({ detail: 'Session busy.' }));
    throw new Error(
      `HTTP 409 Concurrent Request Guard: ${body.detail || 'Session already busy.'}`
    );
  }
  if (!response.ok || !response.body) {
    throw new Error(
      `HTTP ${response.status}: Failed to stream response from Copilot backend.`
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let accumulated = '';

  const processSseLine = (rawLine: string) => {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) return;
    if (!line.startsWith('data:')) return;

    const jsonText = line.slice(5).trim();
    if (!jsonText || jsonText === '[DONE]') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      const delta = (accumulated ? '\n' : '') + jsonText;
      accumulated += delta;
      params.onChunk(delta);
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;
    const payload = parsed as Record<string, unknown>;
    if (payload.error_message) {
      throw new Error(String(payload.error_message));
    }

    const chunkText = extractAdkText(payload);
    if (chunkText) {
      const isPartial = payload.partial === true;
      const delta = accumulated && !isPartial ? `\n\n${chunkText}` : chunkText;
      accumulated += delta;
      params.onChunk(delta);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const rawLine of lines) {
      processSseLine(rawLine);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const rawLine of buffer.split(/\r?\n/)) {
      processSseLine(rawLine);
    }
  }

  if (!accumulated.trim()) {
    const fallback =
      'Query completed with empty text payload. Inspect another portal view for tabular data.';
    accumulated = fallback;
    params.onChunk(fallback);
  }

  return {
    nextSteps: deriveNextSteps(accumulated, params.my_brand_id),
  };
}
