import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptCreativeItem,
  adaptCreativesResponse,
  adaptMmmResponse,
  adaptOverrideResponse,
  adaptOverviewResponse,
  adaptThemesResponse,
  adaptVelocityResponse,
  getMediaUrl,
  getPortalThemes,
  normalizeWearoutPct,
  postOverride,
  toBackendBrand,
  toUiBrandId,
} from './api';

test('brand translation and wearout normalization handle backend variants cleanly', () => {
  assert.equal(toBackendBrand('bmw'), 'BMW');
  assert.equal(toBackendBrand('mercedes'), 'Mercedes-Benz');
  assert.equal(toBackendBrand('audi'), 'Audi');
  assert.equal(toBackendBrand('porsche'), 'Porsche');

  assert.equal(toUiBrandId('BMW'), 'bmw');
  assert.equal(toUiBrandId('BMW M'), 'bmw');
  assert.equal(toUiBrandId('Mercedes-Benz'), 'mercedes');
  assert.equal(toUiBrandId('Mercedes-AMG Official'), 'mercedes');
  assert.equal(toUiBrandId('Audi Sport'), 'audi');
  assert.equal(toUiBrandId('Porsche Motorsport'), 'porsche');
  assert.equal(toUiBrandId('Unverified / Other'), 'Unverified / Other');
  assert.equal(toUiBrandId(null), 'Unverified / Other');

  assert.equal(normalizeWearoutPct(0.72), 72);
  assert.equal(normalizeWearoutPct(0.457), 46);
  assert.equal(normalizeWearoutPct(81), 81);
  assert.equal(normalizeWearoutPct(null), 0);
  assert.equal(getMediaUrl('asset/123'), '/api/v1/media/asset%2F123');
});

test('adaptOverviewResponse maps live FastAPI portal overview + companion counts', () => {
  const out = adaptOverviewResponse(
    {
      market_highlight: {
        total_spend_usd: 38_080_447.51,
        total_impressions: 5_108_967_419,
        audit_coverage_pct: 98.08,
      },
      theme_summary: {
        theme_count: 11,
        fatigued_creative_count: 15,
      },
      velocity_highlight: {
        predicted_breakouts: 9,
      },
    },
    {
      audit_summary: {
        total_assets: 50,
        verified_assets: 49,
        overridden_assets: 1,
        audit_coverage_pct: 98.0,
      },
      items: [],
    },
    {
      sos_sov: {
        country_iso: 'DE',
        country_name: 'Germany',
        total_spend_usd: 38_080_447.51,
        total_impressions: 5_108_967_419,
        audit_coverage_pct: 98.08,
        brands: [],
      },
      themes_and_fatigue: {
        category_hhi: 1683.57,
        hhi_concentration: 'Moderate',
        themes: [],
        jaccard_overlaps: [],
        scatter_points: [],
        fatigue_alerts: [
          {
            asset_id: 'a1',
            brand_id: 'BMW',
            channel_group: 'display',
            active_weeks: 10,
            spend_usd: 100_000,
            is_fatigued: true,
          },
          {
            asset_id: 'a2',
            brand_id: 'Audi',
            channel_group: 'youtube',
            active_weeks: 5,
            spend_usd: 50_000,
            is_fatigued: false,
          },
        ],
      },
    },
    {
      total_scored_videos: 16,
      predicted_breakouts: 9,
      breakout_queue: [
        {
          video_id: 'vid_1',
          channel_title: 'BMW',
          breakout_prob: 0.784,
          alert_threshold: 0.2136,
          is_predicted_breakout: true,
        },
      ],
      drift_report: { generated_at_utc: '2026-11-15T13:42:13+00:00' },
    }
  );

  assert.equal(out.germany_ad_spend_usd, 38_080_447.51);
  assert.equal(out.germany_ad_spend_impressions, 5_108_967_419);
  assert.equal(out.verified_assets, 49);
  assert.equal(out.total_assets, 50);
  assert.equal(out.wearout_spend_at_risk_usd, 10_000);
  assert.equal(out.top_breakout_velocity_x, 3.7);
  assert.equal(out.as_of_date, '2026-11-15');
});

test('adaptThemesResponse scales wearout 0.72 -> 72 critical and preserves market context on filter', () => {
  const out = adaptThemesResponse(
    {
      sos_sov: {
        country_iso: 'DE',
        country_name: 'Germany',
        total_spend_usd: 21_088_082,
        total_impressions: 2_828_936_976,
        audit_coverage_pct: 96.15,
        brands: [
          {
            brand_id: 'Mercedes-Benz',
            total_spend_usd: 10_727_455,
            total_impressions: 1_456_320_146,
            sos_pct: 50.87,
            sov_pct: 51.48,
            peak_creatives_per_month: 12,
          },
          {
            brand_id: 'BMW',
            total_spend_usd: 10_360_627,
            total_impressions: 1_372_616_830,
            sos_pct: 49.13,
            sov_pct: 48.52,
            peak_creatives_per_month: 13,
          },
        ],
      },
      themes_and_fatigue: {
        category_hhi: 1683.57,
        hhi_concentration: 'Moderate',
        themes: [
          {
            theme_id: 'thm_ev_range',
            theme_label: 'EV Range & Charging Infrastructure',
            scope: 'shared_battleground',
            participating_brands: 2,
            brands: ['BMW', 'Mercedes-Benz'],
            spend_usd: 10_133_722.51,
            share_pct: 26.61,
          },
          {
            theme_id: 'thm_bmw_track',
            theme_label: 'BMW Motorsport & Track Heritage',
            scope: 'brand_exclusive_whitespace',
            participating_brands: 1,
            brands: ['BMW'],
            spend_usd: 1_500_000,
            share_pct: 4.5,
          },
        ],
        jaccard_overlaps: [
          {
            brand_a: 'BMW',
            brand_b: 'Mercedes-Benz',
            jaccard_similarity: 0.4286,
            shared_themes: ['EV Range & Charging Infrastructure'],
          },
        ],
        scatter_points: [
          {
            asset_id: 'asset_bmw_01',
            theme_label: 'EV Range & Charging Infrastructure',
            brand_id_raw: 'BMW',
            media_type: 'image',
            umap_x: -3.7,
            umap_y: -6.2,
          },
          {
            asset_id: 'asset_mbz_01',
            theme_label: 'EV Range & Charging Infrastructure',
            brand_id_raw: 'Mercedes-Benz',
            media_type: 'video',
            umap_x: 1.2,
            umap_y: 2.1,
          },
        ],
        fatigue_alerts: [
          {
            asset_id: '128ebc73d1c7c9758fef6d27',
            short_asset_id: '8fef6d27',
            brand_id: 'BMW',
            focal_brand_id: 'BMW',
            theme_label: 'BMW Motorsport & Track Heritage',
            channel_group: 'display',
            active_weeks: 78,
            spend_usd: 548_541.14,
            peak_weekly_impressions: 8_604_268,
            recent_weekly_impressions: 2_409_195,
            impression_decay_ratio: 0.28,
            wearout_score: 0.72,
            is_fatigued: true,
          },
          {
            asset_id: 'ba4fdb26b96ed0f33a9bd72f',
            brand_id: 'Mercedes-Benz',
            channel_group: 'tiktok_paid',
            active_weeks: 100,
            spend_usd: 500_000,
            impression_decay_ratio: 0.5428,
            wearout_score: 0.457,
            is_fatigued: true,
          },
        ],
      },
    },
    'bmw'
  );

  assert.equal(out.sos_sov.brands.length, 2);
  assert.equal(out.themes_and_fatigue.hhi_concentration, 'Moderately Concentrated');
  assert.equal(out.themes_and_fatigue.themes[0].brand_counts.bmw, 1);
  assert.equal(out.themes_and_fatigue.themes[0].brand_counts.mercedes, 1);
  assert.ok(out.themes_and_fatigue.themes[1].whitespace_score >= 78);
  assert.equal(out.themes_and_fatigue.scatter_points.length, 1);
  assert.equal(out.themes_and_fatigue.fatigue_alerts.length, 1);
  assert.equal(out.themes_and_fatigue.fatigue_alerts[0].wearout_score, 72);
  assert.equal(out.themes_and_fatigue.fatigue_alerts[0].status, 'critical');
  assert.equal(out.themes_and_fatigue.fatigue_alerts[0].decay_pct, -72);
  assert.equal(out.themes_and_fatigue.fatigue_alerts[0].weekly_spend_at_risk_usd, 7033);
});

test('adaptCreativesResponse and adaptOverrideResponse map DuckDB items without fabricated spend', () => {
  const creatives = adaptCreativesResponse({
    audit_summary: {
      total_assets: 50,
      verified_assets: 49,
      overridden_assets: 1,
      audit_coverage_pct: 98,
    },
    items: [
      {
        asset_id: '03956469b77cb39a1c161e97',
        short_asset_id: '1c161e97',
        brand_id_raw: 'Porsche',
        evaluated_brand_id: 'Porsche',
        matched_brand_id: 'Porsche',
        belongs_to_brand: true,
        source_connector: 'meta_ad_lib_eu',
        media_type: 'image',
        aspect_ratio: '4:5',
        category: 'EU Automotive',
        theme_label: 'EV Range & Charging Infrastructure',
        theme_scope: 'shared_battleground',
        hook_type: 'product_demo',
        hook_transcript: 'Porsche - EV Range & Charging Infrastructure',
        time_to_brand_sec: 1.1,
        cta_clarity_score: 4,
        format_fit_score: 95,
        confidence: 0.94,
        wearout_score: 0.457,
        impression_decay_ratio: 0.5428,
        is_fatigued: true,
        has_human_override: false,
      },
      {
        asset_id: 'unv_0001',
        matched_brand_id: 'BMW',
        belongs_to_brand: false,
        theme_scope: 'brand_exclusive_whitespace',
      },
    ],
  });

  assert.equal(creatives.items[0].matched_brand_id, 'porsche');
  assert.equal(creatives.items[0].channel, 'Meta Ad Library');
  assert.equal(creatives.items[0].wearout_score, 46);
  assert.equal(creatives.items[0].fatigue_status, 'warning');
  assert.equal(creatives.items[0].decay_pct, -45.7);
  assert.equal(creatives.items[0].spend_usd, null);
  assert.equal(creatives.items[0].impressions, null);
  assert.equal(creatives.items[1].matched_brand_id, 'Unverified / Other');
  assert.equal(creatives.items[1].whitespace_theme, true);

  const overrideRes = adaptOverrideResponse({
    status: 'success',
    latency_ms: 14.2,
    override: {
      override_id: 'ovr_123',
      field_name: 'matched_brand_id',
      ai_value: 'Porsche',
      human_value: 'BMW',
      reviewer: 'A. Hoffmann',
      reason: 'Confirmed BMW badge in frame',
      created_at: '2026-11-21T10:00:00Z',
    },
    updated_items: [
      {
        asset_id: '03956469b77cb39a1c161e97',
        matched_brand_id: 'BMW',
        belongs_to_brand: true,
        has_human_override: true,
        override_reviewer: 'A. Hoffmann',
      },
    ],
    audit_summary: {
      total_assets: 50,
      verified_assets: 50,
      overridden_assets: 2,
      audit_coverage_pct: 100,
    },
  });

  assert.equal(overrideRes.updated_item.matched_brand_id, 'bmw');
  assert.equal(overrideRes.updated_item.is_overridden, true);
  assert.equal(overrideRes.updated_item.last_override?.reviewer, 'A. Hoffmann');
  assert.equal(overrideRes.latency_ms, 14.2);
});

test('adaptMmmResponse normalizes weekly spends and marginal response per $1k', () => {
  const mmm = adaptMmmResponse({
    artifact_scope: { brand_id: 'BMW', country_iso: 'DE', used_fallback_scope: false },
    panel_type: 'conversions',
    roas_claim_blocked: false,
    roi_label: 'incremental_roas',
    disclaimer: 'Incremental channel ROAS calibrated against 1st-party/DGP conversion outcomes.',
    channels: {
      own_spend_meta_usd: {
        baseline_weekly_spend_usd: 23173.03,
        beta: 279.28,
        ec50_usd: 22519.58,
        slope: 1.38,
      },
      own_spend_youtube_usd: {
        baseline_weekly_spend_usd: 20761.19,
        beta: 381.95,
        ec50_usd: 25999.13,
        slope: 1.23,
      },
      own_spend_tiktok_usd: {
        baseline_weekly_spend_usd: 11851.55,
        beta: 271.32,
        ec50_usd: 16451.65,
        slope: 1.17,
      },
      own_spend_display_usd: {
        baseline_weekly_spend_usd: 10628.51,
        beta: 81.07,
        ec50_usd: 19168.3,
        slope: 1.11,
      },
    },
    theme_attribution: [
      {
        theme_label: 'EV Range & Charging Infrastructure',
        spend_share_pct: 30.53,
        estimated_contribution: 7304.96,
        contribution_share_pct: 53.7,
      },
    ],
    ladder_comparison: [
      { tier: 'tier1_spend_proportional', rmse: 56.36, mape_pct: 6.2, r2: 0.43 },
      {
        tier: 'tier3_bayesian_pymc_nutpie',
        rmse: 8.82,
        mape_pct: 0.9,
        r2: 0.986,
        max_rhat: 1.004,
        min_ess: 850,
        divergences: 0,
      },
    ],
    simulation: {
      baseline_total_spend_usd: 66414.28,
      simulated_total_spend_usd: 66414.28,
      baseline_total_contribution: 444.8,
      simulated_total_contribution: 460.0,
      expected_outcome_lift_pct: 3.42,
      channels: [
        {
          channel: 'own_spend_tiktok_usd',
          baseline_weekly_spend_usd: 11851.55,
          simulated_weekly_spend_usd: 15851.55,
          spend_delta_usd: 4000,
          baseline_contribution: 110.02,
          simulated_contribution: 132.4,
          saturation_pct: 40.55,
          marginal_response_per_usd: 0.006417,
          roas_mean: 9.82,
          roas_hdi_90: [4.34, 16.53],
        },
      ],
    },
  });

  assert.equal(mmm.brand_id, 'bmw');
  assert.equal(mmm.channels.own_spend_meta_usd.curve_points.length, 17);
  assert.ok(mmm.channels.own_spend_meta_usd.max_spend_usd >= 50_000);
  assert.equal(mmm.simulation.channels[0].marginal_response_per_usd, 6.42);
  assert.equal(mmm.simulation.channels[0].roas_hdi_low, 4.34);
  assert.equal(mmm.theme_attribution[0].efficiency_index, 1.76);
  assert.equal(mmm.ladder_comparison[1].selected, true);
});

test('adaptVelocityResponse converts drift_report.feature_results dict into sorted array with bin means', () => {
  const vel = adaptVelocityResponse({
    total_scored_videos: 16,
    predicted_breakouts: 9,
    breakout_queue: [
      {
        video_id: 'vid_bmw_001',
        brand_id: 'BMW',
        channel_title: 'BMW M',
        published_at: '2026-11-10 14:00:00',
        title: 'BMW Neue Klasse iX3',
        is_short: false,
        breakout_prob: 0.784,
        alert_threshold: 0.2136,
        is_predicted_breakout: true,
        channel_historical_avg_views_30d: 612_400,
      },
    ],
    drift_report: {
      overall_status: 'drift_alert',
      mean_psi: 0.0817,
      max_psi: 0.7703,
      baseline_sample_size: 964,
      target_sample_size: 16,
      generated_at_utc: '2026-11-15T13:42:13+00:00',
      feature_results: {
        stable_feat: {
          feature_name: 'stable_feat',
          psi: 0.04,
          status: 'stable',
        },
        drifted_feat: {
          feature_name: 'drifted_feat',
          psi: 0.77,
          status: 'drift_alert',
          baseline_distribution: [0.5, 0.5],
          target_distribution: [0.2, 0.8],
          bin_edges: [0, 10, 20],
        },
      },
    },
    finops_summary: {
      total_estimated_cost_usd: 0.2975,
      total_calls: 54,
      failed_calls: 0,
      by_stage: [
        {
          stage: 'vision_dissection',
          sku: 'mm_video_essential',
          calls: 25,
          cost_usd: 0.285,
        },
      ],
    },
    vision_eval: {
      benchmark_name: 'Golden Vision Eval v1',
      total_cases: 50,
      positive_cases: 36,
      negative_trap_cases: 14,
      manifest_present: true,
      gates: { min_brand_f1: 0.85, max_fpr: 0.15, min_hook_accuracy: 0.8 },
    },
  });

  assert.equal(vel.breakout_queue[0].brand_id, 'bmw');
  assert.equal(vel.breakout_queue[0].velocity_multiplier, 3.7);
  assert.equal(vel.drift_report.features.length, 2);
  assert.equal(vel.drift_report.features[0].feature_name, 'drifted_feat');
  assert.equal(vel.drift_report.features[0].status, 'alert');
  assert.equal(vel.drift_report.features[0].baseline_mean, 10);
  assert.equal(vel.drift_report.features[0].current_mean, 13);
  assert.equal(vel.drift_report.features[1].baseline_mean, 0);
  assert.equal(vel.finops_summary.stages[0].model, 'mm_video_essential');
  assert.equal(vel.vision_eval.gates[0].actual, null);
  assert.equal(vel.vision_eval.gates[0].passed, null);
});

test('postOverride translates brand IDs to backend names while preserving Unverified / Other', async () => {
  const originalFetch = globalThis.fetch;
  const capturedBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBodies.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response(
      JSON.stringify({
        status: 'success',
        latency_ms: 9.5,
        override: {
          override_id: 'ovr_1',
          field_name: 'matched_brand_id',
          ai_value: 'BMW',
          human_value: 'Mercedes-Benz',
          reviewer: 'A. Hoffmann',
          reason: 'Badge check',
          created_at: '2026-11-21T10:00:00Z',
        },
        updated_items: [
          {
            asset_id: 'asset_1',
            matched_brand_id: 'Mercedes-Benz',
            belongs_to_brand: true,
            has_human_override: true,
          },
        ],
        audit_summary: {
          total_assets: 50,
          verified_assets: 50,
          overridden_assets: 1,
          audit_coverage_pct: 100,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    await postOverride({
      target_key_type: 'asset_id',
      target_key_value: 'asset_1',
      field_name: 'matched_brand_id',
      human_value: 'mercedes',
      reviewer: 'A. Hoffmann',
      reason: 'Badge check',
      ai_value: 'bmw',
    });
    assert.equal(capturedBodies[0].human_value, 'Mercedes-Benz');
    assert.equal(capturedBodies[0].ai_value, 'BMW');

    await postOverride({
      target_key_type: 'asset_id',
      target_key_value: 'asset_1',
      field_name: 'matched_brand_id',
      human_value: 'Unverified / Other',
      reviewer: 'A. Hoffmann',
      reason: 'Not an auto OEM',
      ai_value: 'bmw',
    });
    assert.equal(capturedBodies[1].human_value, 'Unverified / Other');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getPortalThemes passes brand_id query parameter and adaptCreativeItem infers theme/category overrides cleanly', async () => {
  const originalFetch = globalThis.fetch;
  const capturedUrls: string[] = [];

  globalThis.fetch = (async (url: string | URL | Request) => {
    capturedUrls.push(String(url));
    return new Response(
      JSON.stringify({
        sos_sov: {
          country_iso: 'DE',
          country_name: 'Germany',
          total_spend_usd: 1000,
          total_impressions: 10000,
          audit_coverage_pct: 95,
          brands: [],
        },
        themes_and_fatigue: {
          category_hhi: 1800,
          hhi_concentration: 'Moderate',
          themes: [],
          jaccard_overlaps: [],
          scatter_points: [],
          fatigue_alerts: [],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    await getPortalThemes({ country: 'Germany', brand_id: 'audi' });
    await getPortalThemes({ country: 'Germany', brand_id: 'all' });
    assert.ok(capturedUrls[0].includes('brand_id=Audi'));
    assert.ok(!capturedUrls[1].includes('brand_id='));
  } finally {
    globalThis.fetch = originalFetch;
  }

  const themeOverridden = adaptCreativeItem({
    asset_id: 'a_theme',
    matched_brand_id: 'BMW',
    belongs_to_brand: true,
    has_human_override: true,
    override_reviewer: 'A. Hoffmann',
    ai_theme_label: 'Old Theme',
    theme_label: 'EV Range & Charging Infrastructure',
  });
  assert.equal(themeOverridden.last_override?.field_name, 'theme_label');
  assert.equal(
    themeOverridden.last_override?.human_value,
    'EV Range & Charging Infrastructure'
  );

  const genericOverridden = adaptCreativeItem({
    asset_id: 'a_generic',
    matched_brand_id: 'BMW',
    belongs_to_brand: true,
    has_human_override: true,
    override_reviewer: 'A. Hoffmann',
  });
  assert.equal(genericOverridden.last_override?.field_name, 'audit_override');

  const velOffset = adaptVelocityResponse({
    total_scored_videos: 1,
    predicted_breakouts: 0,
    breakout_queue: [
      {
        video_id: 'v_offset',
        channel_title: 'BMW',
        published_at: '2025-01-01T00:00:00+00:00',
        breakout_prob: 0.1,
      },
    ],
  });
  assert.ok(velOffset.breakout_queue[0].published_days_ago > 100);
});
