import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDecisionBrief,
  classifyCreativePlaybook,
  computeMmmSimulation,
  evaluateHillResponse,
  evaluateHillSaturationPct,
  formatCompactNumber,
  formatCurrency,
  matchesBrandOrSubBrand,
  optimizeBudgetAllocation,
} from './analytics';
import type {
  CreativeItem,
  MmmChannelCurve,
  MmmChannelKey,
  PortalThemesResponse,
  VelocityBreakoutItem,
} from './types';

test('matchesBrandOrSubBrand matches OEM sub-brands accurately', () => {
  assert.equal(
    matchesBrandOrSubBrand({ brand_id: 'bmw', sub_brand_label: 'BMW M' }, 'bmw'),
    true
  );
  assert.equal(
    matchesBrandOrSubBrand({ sub_brand_label: 'Mercedes-AMG' }, 'mercedes'),
    true
  );
  assert.equal(
    matchesBrandOrSubBrand({ channel_name: 'Audi Sport Official' }, 'audi'),
    true
  );
  assert.equal(
    matchesBrandOrSubBrand(
      { brand_id: 'porsche', sub_brand_label: 'Porsche Motorsport' },
      'bmw'
    ),
    false
  );
  assert.equal(
    matchesBrandOrSubBrand(
      { brand_id: 'porsche', sub_brand_label: 'Porsche Motorsport' },
      'all'
    ),
    true
  );
});

test('classifyCreativePlaybook differentiates My Brand vs Competitor states', () => {
  const baseCreative: CreativeItem = {
    asset_id: 'BMW-DE-1001',
    short_asset_id: '1001',
    matched_brand_id: 'bmw',
    brand_name: 'BMW',
    category: 'EV Performance',
    channel: 'YouTube',
    country: 'Germany',
    media_type: 'video',
    aspect_ratio: '16:9',
    theme_label: 'Charging Ecosystem',
    hook_type: 'product_demo',
    hook_transcript: 'Test hook',
    time_to_brand_sec: 2.1,
    cta_clarity_score: 4,
    format_fit_score: 88,
    wearout_score: 76,
    decay_pct: -45,
    fatigue_status: 'critical',
    whitespace_theme: false,
    spend_usd: 240000,
    impressions: 9200000,
    is_verified: true,
    is_overridden: false,
  };

  const ownFatigued = classifyCreativePlaybook(baseCreative, 'bmw');
  assert.equal(ownFatigued.badge, 'Refresh Opening Hook');
  assert.equal(ownFatigued.isOwnBrand, true);

  const rivalFatigued = classifyCreativePlaybook(baseCreative, 'audi');
  assert.equal(rivalFatigued.badge, 'Competitor Fatigue Window');
  assert.equal(rivalFatigued.isOwnBrand, false);

  const slowBrand = classifyCreativePlaybook(
    { ...baseCreative, wearout_score: 25, fatigue_status: 'healthy', time_to_brand_sec: 4.8 },
    'bmw'
  );
  assert.equal(slowBrand.badge, 'Tighten Branding & CTA');

  const winner = classifyCreativePlaybook(
    {
      ...baseCreative,
      wearout_score: 20,
      fatigue_status: 'healthy',
      whitespace_theme: true,
      format_fit_score: 91,
    },
    'bmw'
  );
  assert.equal(winner.badge, 'Scale Whitespace Winner');

  const unverified = classifyCreativePlaybook(
    { ...baseCreative, matched_brand_id: 'Unverified / Other', is_verified: false },
    'bmw'
  );
  assert.equal(unverified.badge, 'Brand Match Review Needed');
});

test('buildDecisionBrief compares against top rival when All Brands selected', () => {
  const themesData: PortalThemesResponse = {
    sos_sov: {
      country_iso: 'DE',
      country_name: 'Germany',
      total_spend_usd: 10_000_000,
      total_impressions: 300_000_000,
      audit_coverage_pct: 84,
      brands: [
        {
          brand_id: 'bmw',
          brand_name: 'BMW',
          spend_usd: 3_100_000,
          impressions: 102_000_000,
          sos_pct: 31.0,
          sov_pct: 34.0,
          efficiency_gap_pp: 3.0,
          active_creatives: 24,
        },
        {
          brand_id: 'mercedes',
          brand_name: 'Mercedes-Benz',
          spend_usd: 3_600_000,
          impressions: 96_000_000,
          sos_pct: 36.0,
          sov_pct: 32.0,
          efficiency_gap_pp: -4.0,
          active_creatives: 28,
        },
        {
          brand_id: 'audi',
          brand_name: 'Audi',
          spend_usd: 2_100_000,
          impressions: 66_000_000,
          sos_pct: 21.0,
          sov_pct: 22.0,
          efficiency_gap_pp: 1.0,
          active_creatives: 18,
        },
      ],
    },
    themes_and_fatigue: {
      category_hhi: 2940,
      hhi_concentration: 'Highly Concentrated',
      themes: [
        {
          theme_id: 't1',
          theme_label: 'Bidirectional Home Charging',
          asset_count: 6,
          total_spend_usd: 800_000,
          share_of_spend_pct: 8.0,
          avg_wearout_score: 24,
          brand_counts: { bmw: 0, mercedes: 3, audi: 2, porsche: 1 },
          whitespace_score: 88,
          color: '#0d9488',
        },
      ],
      jaccard_overlaps: [],
      scatter_points: [],
      fatigue_alerts: [
        {
          asset_id: 'BMW-DE-01',
          short_asset_id: 'DE01',
          brand_id: 'bmw',
          brand_name: 'BMW',
          channel: 'YouTube',
          theme_label: 'EV Performance',
          active_weeks: 12,
          peak_weekly_impressions: 2_000_000,
          recent_weekly_impressions: 900_000,
          decay_pct: -55,
          wearout_score: 82,
          weekly_spend_at_risk_usd: 140_000,
          status: 'critical',
        },
      ],
    },
  };

  const breakouts: VelocityBreakoutItem[] = [
    {
      video_id: 'yt1',
      title: 'BMW M Neue Klasse Drift Test',
      channel_name: 'BMW M',
      brand_id: 'bmw',
      sub_brand_label: 'BMW M',
      theme_label: 'Bidirectional Home Charging',
      country: 'Germany',
      views_7d: 1_200_000,
      velocity_multiplier: 4.2,
      breakout_probability: 0.91,
      published_days_ago: 3,
      predicted_breakout: true,
    },
  ];

  const briefAll = buildDecisionBrief(themesData, 'bmw', 'all', breakouts);
  assert.equal(briefAll.length, 3);
  assert.ok(briefAll[0].title.includes('Mercedes-Benz'));
  assert.equal(briefAll[1].headline, 'Bidirectional Home Charging');
  assert.ok(briefAll[2].headline.includes('$140k/wk'));

  const briefMercedes = buildDecisionBrief(themesData, 'mercedes', 'all', breakouts);
  assert.ok(briefMercedes[0].title.includes('BMW'));
});

test('Hill curve math and budget optimizer increase total contribution at constant budget', () => {
  const makeChannel = (
    key: MmmChannelKey,
    label: string,
    alpha: number,
    k: number,
    maxC: number,
    base: number
  ): MmmChannelCurve => ({
    channel_key: key,
    channel_label: label,
    alpha,
    half_saturation_k: k,
    max_contribution: maxC,
    baseline_spend_usd: base,
    min_spend_usd: 150_000,
    max_spend_usd: 2_500_000,
    curve_points: [],
  });

  const channels: Record<MmmChannelKey, MmmChannelCurve> = {
    own_spend_meta_usd: makeChannel(
      'own_spend_meta_usd',
      'Meta Paid Social',
      1.4,
      900_000,
      14_000,
      1_100_000
    ),
    own_spend_youtube_usd: makeChannel(
      'own_spend_youtube_usd',
      'YouTube Video',
      1.5,
      1_150_000,
      18_500,
      950_000
    ),
    own_spend_tiktok_usd: makeChannel(
      'own_spend_tiktok_usd',
      'TikTok Short-Form',
      1.35,
      650_000,
      11_200,
      350_000
    ),
    own_spend_display_usd: makeChannel(
      'own_spend_display_usd',
      'Programmatic Display',
      1.25,
      500_000,
      6_400,
      1_000_000
    ),
  };

  assert.equal(evaluateHillSaturationPct(900_000, 1.4, 900_000), 50);
  assert.equal(evaluateHillResponse(900_000, 1.4, 900_000, 14_000), 7_000);

  const totalBudget = 3_400_000;
  const optimized = optimizeBudgetAllocation(channels, totalBudget);
  const sumOptimized = Object.values(optimized).reduce((a, b) => a + b, 0);
  assert.equal(sumOptimized, totalBudget);

  const sim = computeMmmSimulation(channels, optimized, 'conversions');
  assert.ok(
    sim.expected_outcome_lift_pct > 0,
    `Expected positive lift from optimizer, got ${sim.expected_outcome_lift_pct}%`
  );
  assert.ok(
    optimized.own_spend_display_usd < channels.own_spend_display_usd.baseline_spend_usd
  );
  assert.ok(
    optimized.own_spend_tiktok_usd > channels.own_spend_tiktok_usd.baseline_spend_usd
  );
});

test('formatCurrency places negative sign before dollar sign in compact mode', () => {
  assert.equal(formatCurrency(-90_000, true), '-$90k');
  assert.equal(formatCurrency(-1_250_000, true), '-$1.25M');
  assert.equal(formatCurrency(470_000, true), '$470k');
  assert.equal(formatCompactNumber(5_108_967_419), '5.1B');
  assert.equal(formatCompactNumber(12_400_000), '12.4M');
});
