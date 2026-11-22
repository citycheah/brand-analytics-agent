import {
  BRAND_CATALOG,
  type BrandFilterValue,
  type BrandId,
  type CreativeItem,
  type MmmChannelCurve,
  type MmmChannelKey,
  type MmmPanelType,
  type MmmSimulationChannelRow,
  type PortalThemesResponse,
  type VelocityBreakoutItem,
} from './types';

export interface PlaybookAssessment {
  badge:
    | 'Brand Match Review Needed'
    | 'Competitor Fatigue Window'
    | 'Competitor Whitespace Angle'
    | 'Competitor Benchmark'
    | 'Refresh Opening Hook'
    | 'Tighten Branding & CTA'
    | 'Scale Whitespace Winner'
    | 'Healthy Active Creative';
  tone: 'emerald' | 'amber' | 'rose' | 'neutral';
  actionCallout: string;
  isOwnBrand: boolean;
}

export interface DecisionBriefCard {
  id: 'stance' | 'whitespace' | 'wearout';
  title: string;
  headline: string;
  detail: string;
  tone: 'emerald' | 'amber' | 'rose' | 'neutral';
  metricLabel: string;
  metricValue: string;
}

export function formatCurrency(value: number, compact = false): string {
  if (compact) {
    const sign = value < 0 ? '-' : '';
    const absVal = Math.abs(value);
    if (absVal >= 1_000_000) {
      return `${sign}$${(absVal / 1_000_000).toFixed(2)}M`;
    }
    if (absVal >= 1_000) {
      return `${sign}$${(absVal / 1_000).toFixed(0)}k`;
    }
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(Math.round(value));
}

export function formatSignedPct(value: number, digits = 1): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(digits)}%`;
}

/**
 * Matches OEM brand or sub-brand labels (e.g., BMW M, Mercedes-AMG, Audi Sport, Porsche Motorsport)
 * cleanly against the selected brand filter.
 */
export function matchesBrandOrSubBrand(
  item: { brand_id?: string; sub_brand_label?: string; channel_name?: string },
  selectedBrand: BrandFilterValue
): boolean {
  if (selectedBrand === 'all') {
    return true;
  }
  if (item.brand_id === selectedBrand) {
    return true;
  }
  const meta = BRAND_CATALOG[selectedBrand];
  const haystacks = [item.sub_brand_label ?? '', item.channel_name ?? '']
    .join(' ')
    .toLowerCase();
  return meta.subBrands.some((sb) => haystacks.includes(sb.toLowerCase()));
}

/**
 * Computes the 3 executive Decision Brief cards for Step 2 (Market Share & Themes).
 * Never hardcodes a single competitor when "All Brands" is selected.
 */
export function buildDecisionBrief(
  data: PortalThemesResponse,
  myBrandId: BrandId,
  selectedBrandFilter: BrandFilterValue,
  breakouts: VelocityBreakoutItem[]
): DecisionBriefCard[] {
  const brands = data.sos_sov.brands;
  if (brands.length === 0) {
    return [];
  }

  const myBrandRow = brands.find((b) => b.brand_id === myBrandId) ?? brands[0];
  const competitors = brands
    .filter((b) => b.brand_id !== myBrandId)
    .sort((a, b) => b.spend_usd - a.spend_usd);

  const focalCompetitor =
    (selectedBrandFilter !== 'all' && selectedBrandFilter !== myBrandId
      ? brands.find((b) => b.brand_id === selectedBrandFilter) ?? competitors[0]
      : competitors[0]) ?? myBrandRow;

  const myGap = myBrandRow.sov_pct - myBrandRow.sos_pct;
  const stanceTone: 'emerald' | 'amber' | 'rose' =
    myGap >= 0.8 ? 'emerald' : myGap <= -1.2 ? 'rose' : 'amber';

  const stanceCard: DecisionBriefCard = {
    id: 'stance',
    title: `${myBrandRow.brand_name} vs. ${focalCompetitor.brand_name} Stance`,
    headline:
      myGap >= 0
        ? `Voice efficiency lead of +${myGap.toFixed(1)} pp in ${data.sos_sov.country_name}`
        : `Under-indexed SOV by ${Math.abs(myGap).toFixed(1)} pp vs. Spend Share`,
    detail: `${myBrandRow.brand_name} holds ${myBrandRow.sos_pct.toFixed(1)}% SOS / ${myBrandRow.sov_pct.toFixed(1)}% SOV against ${
      selectedBrandFilter === 'all' ? 'leading rival' : 'selected rival'
    } ${focalCompetitor.brand_name} (${focalCompetitor.sos_pct.toFixed(1)}% SOS / ${focalCompetitor.sov_pct.toFixed(1)}% SOV).`,
    tone: stanceTone,
    metricLabel: 'SOV − SOS Gap',
    metricValue: `${myGap >= 0 ? '+' : ''}${myGap.toFixed(1)} pp`,
  };

  // Whitespace opportunity: highest whitespace_score theme where myBrand has low presence
  const themesByWhitespace = [...data.themes_and_fatigue.themes].sort((a, b) => {
    const aMine = a.brand_counts[myBrandId] ?? 0;
    const bMine = b.brand_counts[myBrandId] ?? 0;
    const aScore = a.whitespace_score - aMine * 4;
    const bScore = b.whitespace_score - bMine * 4;
    return bScore - aScore;
  });
  const topWhitespace = themesByWhitespace[0];
  const matchingBreakouts = breakouts.filter((b) =>
    matchesBrandOrSubBrand(b, selectedBrandFilter)
  );
  const topBreakout = matchingBreakouts[0] ?? breakouts[0];

  const whitespaceCard: DecisionBriefCard = {
    id: 'whitespace',
    title: 'Uncontested Whitespace & Momentum',
    headline: topWhitespace ? topWhitespace.theme_label : 'No whitespace theme detected',
    detail: topWhitespace
      ? `${topWhitespace.brand_counts[myBrandId] ?? 0} active ${myBrandRow.brand_name} creatives (${topWhitespace.share_of_spend_pct.toFixed(1)}% category SOS). Organic YouTube signal: ${
          topBreakout
            ? `${topBreakout.sub_brand_label} surging ${topBreakout.velocity_multiplier.toFixed(1)}x (${Math.round(topBreakout.breakout_probability * 100)}% prob).`
            : 'steady baseline velocity.'
        }`
      : 'Expand market scope to detect emerging theme gaps.',
    tone: 'amber',
    metricLabel: 'Whitespace Index',
    metricValue: topWhitespace ? `${topWhitespace.whitespace_score}/100` : '—',
  };

  // Wearout spend at risk filtered by selectedBrandFilter
  const scopedFatigue = data.themes_and_fatigue.fatigue_alerts.filter((f) =>
    selectedBrandFilter === 'all' ? true : f.brand_id === selectedBrandFilter
  );
  const urgentAlerts = scopedFatigue.filter((f) => f.status !== 'healthy');
  const criticalCount = scopedFatigue.filter((f) => f.status === 'critical').length;
  const totalRiskSpend = urgentAlerts.reduce((acc, f) => acc + f.weekly_spend_at_risk_usd, 0);
  const worstAlert = [...urgentAlerts].sort((a, b) => b.wearout_score - a.wearout_score)[0];

  const wearoutCard: DecisionBriefCard = {
    id: 'wearout',
    title: 'Creative Wearout Spend at Risk',
    headline:
      urgentAlerts.length > 0
        ? `${formatCurrency(totalRiskSpend, true)}/wk across ${urgentAlerts.length} decaying ads`
        : 'Zero urgent wearout alerts in current scope',
    detail: worstAlert
      ? `Most urgent: ${worstAlert.brand_name} #${worstAlert.short_asset_id} (${worstAlert.theme_label}) dropped ${Math.abs(
          worstAlert.decay_pct
        ).toFixed(0)}% from peak over ${worstAlert.active_weeks} weeks.`
      : 'Active creative rotation cadence is keeping impression decay within guardrails.',
    tone: criticalCount > 0 ? 'rose' : urgentAlerts.length > 0 ? 'amber' : 'emerald',
    metricLabel: 'Critical Queue',
    metricValue: `${criticalCount} critical / ${urgentAlerts.length} total`,
  };

  return [stanceCard, whitespaceCard, wearoutCard];
}

/**
 * Classifies each creative into its tailored Playbook Badge & Action Callout
 * based on whether it belongs to My Brand (1st-Party), Unverified, or a Competitor.
 */
export function classifyCreativePlaybook(
  item: CreativeItem,
  myBrandId: BrandId
): PlaybookAssessment {
  if (
    item.matched_brand_id === 'Unverified / Other' ||
    (!item.is_verified && item.confidence != null && item.confidence < 0.7)
  ) {
    return {
      badge: 'Brand Match Review Needed',
      tone: 'rose',
      actionCallout:
        'Unverified brand attribution or low AI confidence — inspect logo/badge in frame and apply a human override.',
      isOwnBrand: false,
    };
  }

  const isOwnBrand = item.matched_brand_id === myBrandId;

  if (!isOwnBrand) {
    if (item.fatigue_status === 'critical' || item.wearout_score >= 70) {
      return {
        badge: 'Competitor Fatigue Window',
        tone: 'amber',
        actionCallout: `Rival impression decay at ${item.decay_pct.toFixed(0)}% — launch counter-creative in "${item.theme_label}" while frequency caps tighten.`,
        isOwnBrand: false,
      };
    }
    if (item.whitespace_theme) {
      return {
        badge: 'Competitor Whitespace Angle',
        tone: 'amber',
        actionCallout: `Uncontested rival positioning in "${item.theme_label}" with ${item.format_fit_score}/100 format fit — evaluate test cell.`,
        isOwnBrand: false,
      };
    }
    return {
      badge: 'Competitor Benchmark',
      tone: 'neutral',
      actionCallout: `Benchmark hook (${item.time_to_brand_sec.toFixed(1)}s brand reveal, ${item.cta_clarity_score}/5 CTA clarity) for creative briefing.`,
      isOwnBrand: false,
    };
  }

  // Own brand (1st-Party)
  if (item.fatigue_status === 'critical' || item.wearout_score >= 68) {
    return {
      badge: 'Refresh Opening Hook',
      tone: 'rose',
      actionCallout: `Severe wearout (${item.wearout_score}/100, ${item.decay_pct.toFixed(0)}% decay) — swap first 3s visual hook while keeping core offer.`,
      isOwnBrand: true,
    };
  }
  if (item.time_to_brand_sec > 3.5 || item.cta_clarity_score <= 2) {
    return {
      badge: 'Tighten Branding & CTA',
      tone: 'amber',
      actionCallout: `Brand reveal at ${item.time_to_brand_sec.toFixed(1)}s and CTA clarity ${item.cta_clarity_score}/5 — pull emblem inside 2.5s with explicit dealer CTA.`,
      isOwnBrand: true,
    };
  }
  if (item.whitespace_theme && item.format_fit_score >= 82) {
    return {
      badge: 'Scale Whitespace Winner',
      tone: 'emerald',
      actionCallout: `High format fit (${item.format_fit_score}/100) in low-competition "${item.theme_label}" — strong candidate for incremental Germany budget.`,
      isOwnBrand: true,
    };
  }
  return {
    badge: 'Healthy Active Creative',
    tone: 'emerald',
    actionCallout: `Balanced pacing (${item.wearout_score}/100 wearout) and ${item.cta_clarity_score}/5 CTA clarity — maintain flighting and monitor weekly decay.`,
    isOwnBrand: true,
  };
}

/**
 * Standard Hill diminishing-returns response curve:
 * R(S) = maxContribution * (S^alpha / (S^alpha + K^alpha))
 */
export function evaluateHillResponse(
  spendUsd: number,
  alpha: number,
  halfSaturationK: number,
  maxContribution: number
): number {
  if (spendUsd <= 0) return 0;
  const sA = Math.pow(spendUsd, alpha);
  const kA = Math.pow(halfSaturationK, alpha);
  return maxContribution * (sA / (sA + kA));
}

/**
 * First derivative dR/dS of the Hill curve (marginal response per additional dollar).
 */
export function evaluateHillMarginalResponse(
  spendUsd: number,
  alpha: number,
  halfSaturationK: number,
  maxContribution: number
): number {
  const safeSpend = Math.max(spendUsd, 1_000);
  const sA = Math.pow(safeSpend, alpha);
  const kA = Math.pow(halfSaturationK, alpha);
  const denom = Math.pow(sA + kA, 2);
  return (maxContribution * alpha * kA * Math.pow(safeSpend, alpha - 1)) / denom;
}

/**
 * Evaluates saturation percentage (0..100) on the Hill curve.
 */
export function evaluateHillSaturationPct(
  spendUsd: number,
  alpha: number,
  halfSaturationK: number
): number {
  if (spendUsd <= 0) return 0;
  const sA = Math.pow(spendUsd, alpha);
  const kA = Math.pow(halfSaturationK, alpha);
  return (sA / (sA + kA)) * 100;
}

/**
 * Greedy marginal-utility optimizer over bounded channel spend constraints
 * preserving the target total budget while maximizing total Hill contribution.
 */
export function optimizeBudgetAllocation(
  channels: Record<MmmChannelKey, MmmChannelCurve>,
  totalBudgetUsd: number
): Record<MmmChannelKey, number> {
  const keys = Object.keys(channels) as MmmChannelKey[];
  const allocation: Record<MmmChannelKey, number> = {
    own_spend_meta_usd: channels.own_spend_meta_usd.min_spend_usd,
    own_spend_youtube_usd: channels.own_spend_youtube_usd.min_spend_usd,
    own_spend_tiktok_usd: channels.own_spend_tiktok_usd.min_spend_usd,
    own_spend_display_usd: channels.own_spend_display_usd.min_spend_usd,
  };

  let allocated = keys.reduce((acc, k) => acc + allocation[k], 0);
  const step = 10_000;

  if (totalBudgetUsd <= allocated) {
    const ratio = totalBudgetUsd / Math.max(allocated, 1);
    for (const k of keys) {
      allocation[k] = Math.round((allocation[k] * ratio) / 1_000) * 1_000;
    }
    return allocation;
  }

  let guard = 0;
  while (allocated + step <= totalBudgetUsd && guard < 2000) {
    guard += 1;
    let bestKey: MmmChannelKey | null = null;
    let bestMarginal = -1;

    for (const k of keys) {
      const ch = channels[k];
      if (allocation[k] + step > ch.max_spend_usd) continue;
      const marginal = evaluateHillMarginalResponse(
        allocation[k] + step / 2,
        ch.alpha,
        ch.half_saturation_k,
        ch.max_contribution
      );
      if (marginal > bestMarginal) {
        bestMarginal = marginal;
        bestKey = k;
      }
    }

    if (!bestKey) break;
    allocation[bestKey] += step;
    allocated += step;
  }

  const remainder = Math.round(totalBudgetUsd - allocated);
  if (remainder > 0) {
    let bestKey: MmmChannelKey = keys[0];
    let bestMarginal = -1;
    for (const k of keys) {
      const ch = channels[k];
      if (allocation[k] + remainder > ch.max_spend_usd) continue;
      const marginal = evaluateHillMarginalResponse(
        allocation[k],
        ch.alpha,
        ch.half_saturation_k,
        ch.max_contribution
      );
      if (marginal > bestMarginal) {
        bestMarginal = marginal;
        bestKey = k;
      }
    }
    allocation[bestKey] += remainder;
  }

  return allocation;
}

/**
 * Computes full MMM simulation channel rows and aggregate outcome lift.
 */
export function computeMmmSimulation(
  channels: Record<MmmChannelKey, MmmChannelCurve>,
  proposedSpend: Record<MmmChannelKey, number>,
  panelType: MmmPanelType
): {
  baseline_total_spend_usd: number;
  simulated_total_spend_usd: number;
  baseline_total_contribution: number;
  simulated_total_contribution: number;
  expected_outcome_lift_pct: number;
  channels: MmmSimulationChannelRow[];
} {
  const keys = Object.keys(channels) as MmmChannelKey[];
  const conversionValueUsd = panelType === 'conversions' ? 420 : 1;

  let baselineTotalSpend = 0;
  let simulatedTotalSpend = 0;
  let baselineTotalContribution = 0;
  let simulatedTotalContribution = 0;

  const rows: MmmSimulationChannelRow[] = keys.map((k) => {
    const ch = channels[k];
    const baseSpend = ch.baseline_spend_usd;
    const propSpend = Math.max(0, proposedSpend[k] ?? baseSpend);

    const baseContrib = evaluateHillResponse(
      baseSpend,
      ch.alpha,
      ch.half_saturation_k,
      ch.max_contribution
    );
    const propContrib = evaluateHillResponse(
      propSpend,
      ch.alpha,
      ch.half_saturation_k,
      ch.max_contribution
    );

    const marginalUnitsPerDollar = evaluateHillMarginalResponse(
      propSpend,
      ch.alpha,
      ch.half_saturation_k,
      ch.max_contribution
    );
    const satPct = evaluateHillSaturationPct(propSpend, ch.alpha, ch.half_saturation_k);
    const deltaSpend = propSpend - baseSpend;
    const deltaPct = baseSpend > 0 ? (deltaSpend / baseSpend) * 100 : 0;

    const roasMean =
      propSpend > 0 ? (propContrib * conversionValueUsd) / propSpend : 0;

    baselineTotalSpend += baseSpend;
    simulatedTotalSpend += propSpend;
    baselineTotalContribution += baseContrib;
    simulatedTotalContribution += propContrib;

    return {
      channel_key: k,
      channel_label: ch.channel_label,
      baseline_spend_usd: baseSpend,
      proposed_spend_usd: propSpend,
      delta_spend_usd: deltaSpend,
      delta_pct: Number(deltaPct.toFixed(1)),
      saturation_pct: Number(satPct.toFixed(1)),
      marginal_response_per_usd: Number((marginalUnitsPerDollar * 1000).toFixed(2)),
      roas_mean: Number(roasMean.toFixed(2)),
      roas_hdi_low: Number((roasMean * 0.84).toFixed(2)),
      roas_hdi_high: Number((roasMean * 1.17).toFixed(2)),
      baseline_contribution: Number(baseContrib.toFixed(1)),
      proposed_contribution: Number(propContrib.toFixed(1)),
    };
  });

  const liftPct =
    baselineTotalContribution > 0
      ? ((simulatedTotalContribution - baselineTotalContribution) /
          baselineTotalContribution) *
        100
      : 0;

  return {
    baseline_total_spend_usd: Math.round(baselineTotalSpend),
    simulated_total_spend_usd: Math.round(simulatedTotalSpend),
    baseline_total_contribution: Number(baselineTotalContribution.toFixed(1)),
    simulated_total_contribution: Number(simulatedTotalContribution.toFixed(1)),
    expected_outcome_lift_pct: Number(liftPct.toFixed(2)),
    channels: rows,
  };
}
