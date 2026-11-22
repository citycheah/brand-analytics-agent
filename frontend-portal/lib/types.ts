export type BrandId = 'bmw' | 'mercedes' | 'audi' | 'porsche';

export type BrandFilterValue = BrandId | 'all';

export type CountryName = 'Germany' | 'United Kingdom' | 'France';

export type HookType =
  | 'offer_first'
  | 'product_demo'
  | 'brand_story'
  | 'ugc_testimonial'
  | 'problem_agitation'
  | 'unknown';

export type MmmPanelType = 'conversions' | 'google_trends_proxy';

export type MmmChannelKey =
  | 'own_spend_meta_usd'
  | 'own_spend_youtube_usd'
  | 'own_spend_tiktok_usd'
  | 'own_spend_display_usd';

export interface BrandMeta {
  id: BrandId;
  name: string;
  shortName: string;
  color: string;
  subBrands: string[];
}

export const BRAND_CATALOG: Record<BrandId, BrandMeta> = {
  bmw: {
    id: 'bmw',
    name: 'BMW',
    shortName: 'BMW',
    color: '#2563eb',
    subBrands: ['BMW', 'BMW M', 'BMW i', 'BMW Motorrad'],
  },
  mercedes: {
    id: 'mercedes',
    name: 'Mercedes-Benz',
    shortName: 'Mercedes',
    color: '#0f766e',
    subBrands: ['Mercedes-Benz', 'Mercedes-AMG', 'Mercedes-EQ', 'Maybach'],
  },
  audi: {
    id: 'audi',
    name: 'Audi',
    shortName: 'Audi',
    color: '#d97706',
    subBrands: ['Audi', 'Audi Sport', 'Audi e-tron', 'Audi quattro'],
  },
  porsche: {
    id: 'porsche',
    name: 'Porsche',
    shortName: 'Porsche',
    color: '#be123c',
    subBrands: ['Porsche', 'Porsche Motorsport', 'Porsche E-Performance'],
  },
};

export const BRAND_LIST: BrandMeta[] = Object.values(BRAND_CATALOG);

export const COUNTRY_LIST: CountryName[] = ['Germany', 'United Kingdom', 'France'];

export const HOOK_TYPE_LABELS: Record<HookType, string> = {
  offer_first: 'Offer First',
  product_demo: 'Product Demo',
  brand_story: 'Brand Story',
  ugc_testimonial: 'UGC Testimonial',
  problem_agitation: 'Problem Agitation',
  unknown: 'Unknown',
};

export const CHANNEL_LABELS: Record<MmmChannelKey, string> = {
  own_spend_meta_usd: 'Meta Paid Social',
  own_spend_youtube_usd: 'YouTube Video',
  own_spend_tiktok_usd: 'TikTok Short-Form',
  own_spend_display_usd: 'Programmatic Display',
};

export const CHANNEL_COLORS: Record<MmmChannelKey, string> = {
  own_spend_meta_usd: '#2563eb',
  own_spend_youtube_usd: '#dc2626',
  own_spend_tiktok_usd: '#0d9488',
  own_spend_display_usd: '#7c3aed',
};

export interface PortalOverviewResponse {
  germany_ad_spend_usd: number;
  germany_ad_spend_impressions: number;
  human_verified_accuracy_pct: number;
  audit_coverage_pct: number;
  verified_assets: number;
  total_assets: number;
  active_themes_count: number;
  wearout_alerts_count: number;
  wearout_spend_at_risk_usd: number;
  youtube_breakouts_count: number;
  top_breakout_velocity_x: number;
  as_of_date: string;
}

export interface BrandSosSov {
  brand_id: BrandId;
  brand_name: string;
  spend_usd: number;
  impressions: number;
  sos_pct: number;
  sov_pct: number;
  efficiency_gap_pp: number;
  active_creatives: number;
}

export interface ThemeSummaryItem {
  theme_id: string;
  theme_label: string;
  asset_count: number;
  total_spend_usd: number;
  share_of_spend_pct: number;
  avg_wearout_score: number;
  brand_counts: Record<BrandId, number>;
  whitespace_score: number;
  color: string;
}

export interface JaccardOverlapItem {
  brand_a: BrandId;
  brand_b: BrandId;
  jaccard_index: number;
  shared_themes: string[];
}

export interface ScatterPointItem {
  asset_id: string;
  short_asset_id: string;
  brand_id: BrandId;
  brand_id_raw: string;
  theme_label: string;
  media_type: 'video' | 'image' | 'carousel';
  umap_x: number;
  umap_y: number;
  spend_usd: number;
  wearout_score: number;
}

export interface FatigueAlertItem {
  asset_id: string;
  short_asset_id: string;
  brand_id: BrandId;
  brand_name: string;
  channel: string;
  theme_label: string;
  active_weeks: number;
  peak_weekly_impressions: number;
  recent_weekly_impressions: number;
  decay_pct: number;
  wearout_score: number;
  weekly_spend_at_risk_usd: number;
  status: 'critical' | 'warning' | 'healthy';
}

export interface PortalThemesResponse {
  sos_sov: {
    country_iso: string;
    country_name: CountryName;
    total_spend_usd: number;
    total_impressions: number;
    audit_coverage_pct: number;
    brands: BrandSosSov[];
  };
  themes_and_fatigue: {
    category_hhi: number;
    hhi_concentration: 'Competitive' | 'Moderately Concentrated' | 'Highly Concentrated';
    themes: ThemeSummaryItem[];
    jaccard_overlaps: JaccardOverlapItem[];
    scatter_points: ScatterPointItem[];
    fatigue_alerts: FatigueAlertItem[];
  };
}

export interface AuditSummary {
  verified_assets: number;
  total_assets: number;
  overridden_assets: number;
  audit_coverage_pct: number;
}

export interface CreativeItem {
  asset_id: string;
  short_asset_id: string;
  matched_brand_id: BrandId | 'Unverified / Other';
  brand_name: string;
  category: string;
  channel: string;
  country: string;
  media_type: 'video' | 'image' | 'carousel';
  aspect_ratio: string;
  theme_label: string;
  hook_type: HookType;
  hook_transcript: string;
  time_to_brand_sec: number;
  cta_clarity_score: number; // 1..5
  format_fit_score: number; // 0..100
  wearout_score: number; // 0..100
  decay_pct: number; // e.g. -48.2
  fatigue_status: 'critical' | 'warning' | 'healthy';
  whitespace_theme: boolean;
  spend_usd: number | null;
  impressions: number | null;
  confidence?: number | null;
  source_connector?: string | null;
  is_verified: boolean;
  is_overridden: boolean;
  last_override?: {
    field_name: 'matched_brand_id' | 'theme_label' | 'category' | 'audit_override';
    ai_value: string;
    human_value: string;
    reviewer: string;
    reason: string;
    updated_at: string;
  };
}

export interface CreativesResponse {
  audit_summary: AuditSummary;
  items: CreativeItem[];
}

export interface OverridePayload {
  target_key_type: 'asset_id';
  target_key_value: string;
  field_name: 'matched_brand_id' | 'theme_label' | 'category';
  human_value: string;
  reviewer: string;
  reason: string;
  ai_value: string;
}

export interface OverrideResponse {
  override_id: string;
  status: string;
  latency_ms?: number;
  updated_item: CreativeItem;
  audit_summary: AuditSummary;
}

export interface MmmCurvePoint {
  spend_usd: number;
  expected_contribution: number;
  lower_hdi: number;
  upper_hdi: number;
}

export interface MmmChannelCurve {
  channel_key: MmmChannelKey;
  channel_label: string;
  alpha: number;
  half_saturation_k: number;
  max_contribution: number;
  baseline_spend_usd: number;
  min_spend_usd: number;
  max_spend_usd: number;
  curve_points: MmmCurvePoint[];
}

export interface MmmThemeAttributionRow {
  theme_label: string;
  attributed_contribution: number;
  contribution_share_pct: number;
  spend_share_pct: number;
  efficiency_index: number;
}

export interface MmmLadderRow {
  tier: string;
  label: string;
  rmse: number;
  mape: number;
  r2: number;
  max_rhat: number | null;
  min_ess: number | null;
  divergences: number | null;
  convergence_passed?: boolean;
  selected: boolean;
}

export interface MmmSimulationChannelRow {
  channel_key: MmmChannelKey;
  channel_label: string;
  baseline_spend_usd: number;
  proposed_spend_usd: number;
  delta_spend_usd: number;
  delta_pct: number;
  saturation_pct: number;
  marginal_response_per_usd: number;
  roas_mean: number;
  roas_hdi_low: number;
  roas_hdi_high: number;
  baseline_contribution: number;
  proposed_contribution: number;
}

export interface MmmSimulationRequest {
  brand_id: BrandId;
  country: string;
  total_budget_usd: number;
  proposed_spend_by_channel: Record<MmmChannelKey, number>;
  optimize: boolean;
  panel_type: MmmPanelType;
}

export interface MmmResponse {
  brand_id: BrandId;
  brand_name: string;
  country: string;
  panel_type: MmmPanelType;
  artifact_scope?: {
    brand_id?: string;
    country_iso?: string;
    used_fallback_scope?: boolean;
  };
  is_spend_modeled?: boolean;
  roas_claim_blocked: boolean;
  roi_label: string;
  disclaimer: string;
  channels: Record<MmmChannelKey, MmmChannelCurve>;
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
}

export interface VelocityBreakoutItem {
  video_id: string;
  title: string;
  channel_name: string;
  brand_id: BrandId | 'Unverified / Other';
  sub_brand_label: string;
  theme_label: string;
  country: CountryName;
  views_7d: number;
  velocity_multiplier: number;
  breakout_probability: number;
  published_days_ago: number;
  predicted_breakout: boolean;
}

export interface PsiFeatureDriftItem {
  feature_name: string;
  psi: number;
  baseline_mean: number;
  current_mean: number;
  status: 'alert' | 'warning' | 'ok';
  window_label: string;
}

export interface FinopsStageBreakdown {
  stage: string;
  model: string;
  calls: number;
  failed_calls: number;
  cost_usd: number;
  avg_latency_ms: number;
}

export interface VisionEvalGate {
  metric_key: 'min_brand_f1' | 'max_fpr' | 'min_hook_accuracy';
  label: string;
  actual: number | null;
  threshold: number;
  operator: '>=' | '<=';
  passed: boolean | null;
}

export interface VelocityResponse {
  total_scored_videos: number;
  predicted_breakouts: number;
  breakout_queue: VelocityBreakoutItem[];
  drift_report: {
    evaluated_at: string;
    reference_window: string;
    overall_status?: string;
    mean_psi?: number;
    max_psi?: number;
    alert_threshold?: number;
    total_features_monitored?: number;
    features: PsiFeatureDriftItem[];
  };
  finops_summary: {
    period_label: string;
    total_cost_usd: number;
    total_calls: number;
    failed_calls: number;
    budget_cap_usd: number;
    stages: FinopsStageBreakdown[];
  };
  vision_eval: {
    dataset_name: string;
    evaluated_samples: number;
    positive_cases: number;
    negative_trap_cases: number;
    manifest_present: boolean;
    all_passed: boolean;
    gates: VisionEvalGate[];
  };
}

export interface CopilotNextStepLink {
  label: string;
  path: string;
  step: 2 | 3 | 4;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  nextSteps?: CopilotNextStepLink[];
  streaming?: boolean;
}
