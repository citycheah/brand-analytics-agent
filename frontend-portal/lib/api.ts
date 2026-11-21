/** Typed API client matching FastAPI backend (`brand-analytics-agent/backend/main.py`). */

export interface BrandSosSov {
  brand_id: string;
  total_spend_usd: number;
  total_impressions: number;
  sos_pct: number;
  sov_pct: number;
  audit_coverage_pct: number;
  overridden_assets: number;
  peak_creatives_per_month: number;
}

export interface MonthlyTrendPoint {
  month_start: string;
  country_iso: string;
  brand_id: string;
  spend_usd: number;
  impressions: number;
  sos_pct: number;
  sov_pct: number;
  audit_coverage_pct: number;
  creative_count: number;
}

export interface SosSovResponse {
  status: string;
  country_iso: string;
  country_name: string;
  total_spend_usd: number;
  total_impressions: number;
  audit_coverage_pct: number;
  currency?: string;
  brands: BrandSosSov[];
  monthly_series: MonthlyTrendPoint[];
}

export interface ThemeSummaryItem {
  theme_id: string;
  theme_label: string;
  scope: "shared_battleground" | "brand_exclusive_whitespace";
  participating_brands: number;
  brands: string[];
  spend_usd: number;
  impressions: number;
  share_pct: number;
}

export interface JaccardOverlapItem {
  brand_a: string;
  brand_b: string;
  jaccard_similarity: number;
  shared_themes: string[];
}

export interface FatigueAlertItem {
  asset_id: string;
  short_asset_id?: string;
  brand_id: string;
  focal_brand_id?: string;
  theme_label?: string;
  channel_group: string;
  active_weeks: number;
  span_weeks?: number;
  spend_usd: number;
  impressions: number;
  peak_weekly_impressions?: number;
  recent_weekly_impressions?: number;
  impression_decay_ratio?: number;
  first_week: string;
  last_week: string;
  wearout_score: number;
  is_fatigued: boolean;
}

export interface ScatterPointItem {
  asset_id?: string;
  media_hash_key?: string;
  theme_id?: string;
  theme_label?: string;
  brand_id_raw?: string;
  media_type?: string;
  umap_x?: number;
  umap_y?: number;
  x?: number;
  y?: number;
}

export interface ThemesAndFatigueResponse {
  status: string;
  country_iso: string;
  country_name?: string;
  category_hhi: number;
  hhi_concentration: string;
  themes: ThemeSummaryItem[];
  jaccard_overlaps: JaccardOverlapItem[];
  scatter_points: ScatterPointItem[];
  fatigue_alerts: FatigueAlertItem[];
}

export interface PortalThemesResponse {
  sos_sov: SosSovResponse;
  themes_and_fatigue: ThemesAndFatigueResponse;
}

export interface CreativeItem {
  asset_id: string;
  short_asset_id?: string;
  media_hash_key?: string;
  media_endpoint: string;
  media_type?: string;
  aspect_ratio?: string;
  brand_id_raw?: string;
  evaluated_brand_id?: string;
  matched_brand_id?: string | null;
  belongs_to_brand?: boolean | null;
  theme_id?: string | null;
  theme_label?: string | null;
  category?: string | null;
  confidence?: number | null;
  hook_type?: string | null;
  hook_transcript?: string | null;
  time_to_brand_sec?: number | null;
  cta_text?: string | null;
  cta_clarity_score?: number | null;
  format_fit_score?: number | null;
  has_human_override?: boolean;
  override_reviewer?: string | null;
  override_reason?: string | null;
  is_fatigued?: boolean;
  impression_decay_ratio?: number | null;
  active_weeks?: number | null;
  wearout_score?: number | null;
  theme_scope?: string | null;
}

export interface AuditSummary {
  total_assets: number;
  verified_assets: number;
  overridden_assets: number;
  audit_coverage_pct: number;
}

export interface CreativesResponse {
  status: string;
  count: number;
  audit_summary: AuditSummary;
  items: CreativeItem[];
}

export interface OverridePayload {
  target_key_type: "asset_id" | "media_hash_key" | "theme_label";
  target_key_value: string;
  field_name: "matched_brand_id" | "belongs_to_brand" | "category" | "theme_label";
  human_value: string;
  reviewer: string;
  reason: string;
  ai_value?: string | null;
}

export interface OverrideResponse {
  status: string;
  latency_ms: number;
  override: Record<string, unknown>;
  updated_items: CreativeItem[];
  audit_summary: AuditSummary;
}

export interface MmmChannelCurve {
  baseline_weekly_spend_usd: number;
  beta: number;
  ec50_usd: number;
  slope: number;
  adstock_lambda: number;
  total_spend_usd: number;
  total_contribution: number;
  roas_mean: number;
  roas_sd: number;
  roas_hdi_90: [number, number];
}

export interface MmmSimulationChannelRow {
  channel: string;
  baseline_weekly_spend_usd: number;
  simulated_weekly_spend_usd: number;
  spend_delta_usd: number;
  baseline_contribution: number;
  simulated_contribution: number;
  contribution_delta: number;
  saturation_pct: number;
  marginal_response_per_usd: number;
  adstock_lambda: number;
  roas_mean?: number | null;
  roas_hdi_90?: [number, number] | null;
}

export interface MmmThemeAttributionRow {
  theme_label: string;
  total_spend_usd: number;
  spend_share_pct: number;
  incremental_per_1k_usd: number;
  estimated_contribution: number;
  contribution_share_pct: number;
}

export interface MmmLadderRow {
  tier: string;
  rmse: number;
  mape_pct: number;
  r2: number;
  max_rhat?: number;
  min_ess?: number;
  divergences?: number;
  convergence_passed?: boolean;
}

export interface MmmResponse {
  status: string;
  requested_scope?: { brand_id: string; country_iso: string };
  artifact_scope?: { brand_id?: string; country_iso?: string; used_fallback_scope?: boolean };
  panel_type: string;
  is_proxy_outcome: boolean;
  is_spend_modeled: boolean;
  roas_claim_blocked: boolean;
  roi_label: string;
  disclaimer: string;
  channels: Record<string, MmmChannelCurve>;
  theme_attribution: MmmThemeAttributionRow[];
  ladder_comparison: MmmLadderRow[];
  simulation: {
    baseline_total_spend_usd: number;
    simulated_total_spend_usd: number;
    baseline_total_contribution: number;
    simulated_total_contribution: number;
    expected_outcome_lift_pct: number;
    channels: MmmSimulationChannelRow[];
  };
  available_scopes: Array<{ brand_id: string; country_iso: string; scope_key: string }>;
}

export interface VelocityBreakoutItem {
  video_id: string;
  brand_id?: string | null;
  channel_id: string;
  channel_title: string;
  published_at: string;
  title: string;
  is_short: boolean;
  duration_seconds: number;
  breakout_prob: number;
  alert_threshold: number;
  is_predicted_breakout: boolean;
  is_breakout_actual: number;
  channel_upload_blitz_24h: number;
  channel_upload_blitz_7d: number;
  channel_historical_avg_views_30d: number;
}

export interface VelocityFeatureDrift {
  feature_name: string;
  psi: number;
  status: string;
}

export interface VelocityResponse {
  status: string;
  velocity_source_dir: string;
  total_scored_videos: number;
  predicted_breakouts: number;
  breakout_queue: VelocityBreakoutItem[];
  drift_report: {
    overall_status?: string;
    mean_psi?: number;
    max_psi?: number;
    drifted_features?: string[];
    warning_features?: string[];
    feature_results?: Record<string, VelocityFeatureDrift>;
    generated_at_utc?: string;
    alert_threshold?: number;
  };
  finops_summary: {
    ledger_path?: string;
    total_cost_usd?: number;
    total_estimated_cost_usd?: number;
    total_calls?: number;
    failed_calls?: number;
    by_stage?: Array<Record<string, unknown>>;
  };
  vision_eval: {
    benchmark_name: string;
    total_cases: number;
    positive_cases: number;
    negative_trap_cases: number;
    gates: {
      min_brand_f1: number;
      max_fpr: number;
      min_hook_accuracy: number;
    };
    manifest_present: boolean;
  };
}

export interface PortalOverviewResponse {
  status: string;
  market_highlight: {
    country_iso: string;
    country_name: string;
    total_spend_usd: number;
    total_impressions: number;
    audit_coverage_pct: number;
    brands: BrandSosSov[];
  };
  theme_summary: {
    category_hhi: number;
    hhi_concentration: string;
    theme_count: number;
    fatigued_creative_count: number;
  };
  mmm_highlight: {
    brand_id?: string;
    country_iso?: string;
    champion_tier: string;
    ladder_comparison: MmmLadderRow[];
    is_proxy_outcome: boolean;
  };
  velocity_highlight: {
    total_scored_videos: number;
    predicted_breakouts: number;
    drift_status: string;
    mean_psi: number;
    finops_spend_usd: number;
    golden_eval_cases: number;
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export function getPortalOverview() {
  return fetchJson<PortalOverviewResponse>("/api/v1/portal/overview");
}

export function getPortalThemes(country: string, brandId?: string) {
  const params = new URLSearchParams({ country });
  if (brandId) params.set("brand_id", brandId);
  return fetchJson<PortalThemesResponse>(`/api/v1/portal/themes?${params.toString()}`);
}

export function getPortalCreatives(opts: {
  assetId?: string;
  brandId?: string;
  hookType?: string;
  onlyOverridden?: boolean;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (opts.assetId) params.set("asset_id", opts.assetId);
  if (opts.brandId) params.set("brand_id", opts.brandId);
  if (opts.hookType) params.set("hook_type", opts.hookType);
  if (opts.onlyOverridden) params.set("only_overridden", "true");
  params.set("limit", String(opts.limit ?? 24));
  return fetchJson<CreativesResponse>(`/api/v1/portal/creatives?${params.toString()}`);
}

export function submitHumanOverride(payload: OverridePayload) {
  return fetchJson<OverrideResponse>("/api/v1/overrides", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getPortalMmm(brandId: string, country: string, panelType: string) {
  const params = new URLSearchParams({
    brand_id: brandId,
    country,
    panel_type: panelType,
  });
  return fetchJson<MmmResponse>(`/api/v1/portal/mmm?${params.toString()}`);
}

export function simulateMmmBudget(payload: {
  brand_id: string;
  country: string;
  total_budget_usd?: number;
  proposed_spend_by_channel?: Record<string, number>;
  optimize: boolean;
  panel_type: string;
}) {
  return fetchJson<MmmResponse>("/api/v1/mmm/simulate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getPortalVelocity(topK = 12, brandId?: string) {
  const params = new URLSearchParams({ top_k: String(topK) });
  if (brandId) params.set("brand_id", brandId);
  return fetchJson<VelocityResponse>(`/api/v1/portal/velocity?${params.toString()}`);
}

export function fmtUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function fmtCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
