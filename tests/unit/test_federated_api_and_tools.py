"""Unit and integration API tests for federated lakehouse ADK tools and FastAPI Portal endpoints."""

from __future__ import annotations

import shutil
from pathlib import Path

import httpx
import pytest

from backend.main import app
from brand_analytics_app.tools.cache import REPORT_CACHE
from brand_analytics_app.tools.federated_intel import (
    get_creative_themes_and_fatigue,
    get_velocity_breakout_alerts_and_ops,
    inspect_creative_evidence,
    query_federated_sos_sov,
    run_mmm_what_if_simulation,
)

WORKSPACE_LAKEHOUSE = Path(__file__).resolve().parents[3] / "data" / "eu_auto_lakehouse"
WORKSPACE_VELOCITY = Path(__file__).resolve().parents[3] / "competitive-velocity-ml-engine" / "data" / "gold_velocity"


def _copy_fixture_lakehouse(tmp_path: Path) -> Path:
    dest = tmp_path / "lakehouse"
    shutil.copytree(WORKSPACE_LAKEHOUSE, dest)
    return dest


def test_federated_tools_read_lakehouse_and_enforce_guardrails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    if not WORKSPACE_LAKEHOUSE.exists():
        pytest.skip("eu_auto_lakehouse fixture not present")

    lakehouse = _copy_fixture_lakehouse(tmp_path)
    monkeypatch.setenv("INTEL_LAKEHOUSE_DIR", str(lakehouse))
    if WORKSPACE_VELOCITY.exists():
        monkeypatch.setenv("VELOCITY_GOLD_DIR", str(WORKSPACE_VELOCITY))

    sos = query_federated_sos_sov(country="Germany")
    assert sos["status"] == "success"
    assert sos["audit_coverage_pct"] > 0.0
    assert len(sos["brands"]) >= 4

    themes = get_creative_themes_and_fatigue(country="Germany")
    assert themes["status"] == "success"
    assert themes["category_hhi"] > 0.0
    assert len(themes["themes"]) >= 4
    assert len(themes["jaccard_overlaps"]) >= 3

    creatives = inspect_creative_evidence(limit=10)
    assert creatives["status"] == "success"
    assert creatives["count"] > 0
    assert creatives["items"][0]["media_endpoint"].startswith("/api/v1/media/")
    assert "is_fatigued" in creatives["items"][0]
    assert "theme_scope" in creatives["items"][0]

    unverified_creatives = inspect_creative_evidence(brand_id="Unverified / Other", limit=10)
    assert unverified_creatives["status"] == "success"

    mmm_baseline = run_mmm_what_if_simulation(brand_id="BMW", country="Germany", optimize=False)
    assert mmm_baseline["status"] == "success"
    assert mmm_baseline["simulation"]["expected_outcome_lift_pct"] == pytest.approx(0.0)
    assert all(ch["spend_delta_usd"] == pytest.approx(0.0) for ch in mmm_baseline["simulation"]["channels"])

    mmm = run_mmm_what_if_simulation(brand_id="BMW", country="Germany", optimize=True)
    assert mmm["status"] == "success"
    assert mmm["roas_claim_blocked"] is False
    assert mmm["simulation"]["expected_outcome_lift_pct"] >= 0.0

    proxy_mmm = run_mmm_what_if_simulation(
        brand_id="BMW", country="Germany", panel_type="google_trends_proxy"
    )
    assert proxy_mmm["is_proxy_outcome"] is True
    assert proxy_mmm["roas_claim_blocked"] is True
    assert "blocked" in proxy_mmm["disclaimer"].lower()

    ops = get_velocity_breakout_alerts_and_ops(top_k=5)
    assert ops["status"] == "success"
    assert ops["vision_eval"]["total_cases"] == 50

    eu_vel_dir = lakehouse / "gold" / "velocity_artifacts"
    if eu_vel_dir.exists():
        monkeypatch.setenv("VELOCITY_GOLD_DIR", str(eu_vel_dir))
        bmw_ops = get_velocity_breakout_alerts_and_ops(top_k=20, brand_id="BMW")
        assert bmw_ops["status"] == "success"
        assert bmw_ops["total_scored_videos"] >= 1
        assert all(item["brand_id"] == "BMW" for item in bmw_ops["breakout_queue"])


@pytest.mark.asyncio
async def test_fastapi_portal_overrides_media_and_mmm_endpoints(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    if not WORKSPACE_LAKEHOUSE.exists():
        pytest.skip("eu_auto_lakehouse fixture not present")

    lakehouse = _copy_fixture_lakehouse(tmp_path)
    monkeypatch.setenv("INTEL_LAKEHOUSE_DIR", str(lakehouse))
    if WORKSPACE_VELOCITY.exists():
        monkeypatch.setenv("VELOCITY_GOLD_DIR", str(WORKSPACE_VELOCITY))

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Overview & Themes
        ov = await client.get("/api/v1/portal/overview")
        assert ov.status_code == 200
        assert ov.json()["market_highlight"]["country_iso"] == "DE"

        th = await client.get("/api/v1/portal/themes", params={"country": "Germany"})
        assert th.status_code == 200
        assert len(th.json()["themes_and_fatigue"]["themes"]) >= 4

        # 2. Creatives list + media endpoint
        cr = await client.get("/api/v1/portal/creatives", params={"limit": 5})
        assert cr.status_code == 200
        items = cr.json()["items"]
        assert len(items) > 0
        asset_id = items[0]["asset_id"]

        media_resp = await client.get(f"/api/v1/media/{asset_id}")
        assert media_resp.status_code == 200
        assert media_resp.headers["content-type"].startswith("image/")
        assert len(media_resp.content) > 100

        # 3. Atomic HITL override clears REPORT_CACHE and reflects immediately (<50ms write+view)
        REPORT_CACHE["stale_entry"] = {"cached": True}
        ov_resp = await client.post(
            "/api/v1/overrides",
            json={
                "target_key_type": "asset_id",
                "target_key_value": asset_id,
                "field_name": "matched_brand_id",
                "human_value": "Porsche",
                "reviewer": "portal_qa",
                "reason": "Verified crest on hood",
            },
        )
        assert ov_resp.status_code == 200
        ov_data = ov_resp.json()
        assert ov_data["latency_ms"] < 1000.0
        assert "stale_entry" not in REPORT_CACHE
        assert ov_data["updated_items"][0]["has_human_override"] is True
        assert ov_data["updated_items"][0]["matched_brand_id"] == "Porsche"

        # 4. Pure-Python MMM simulation endpoint
        sim_resp = await client.post(
            "/api/v1/mmm/simulate",
            json={
                "brand_id": "BMW",
                "country": "Germany",
                "total_budget_usd": 75000.0,
                "optimize": True,
            },
        )
        assert sim_resp.status_code == 200
        assert sim_resp.json()["simulation"]["simulated_total_spend_usd"] == pytest.approx(75000.0, rel=1e-2)

        # 5. Velocity & Ops endpoint
        vel_resp = await client.get("/api/v1/portal/velocity")
        assert vel_resp.status_code == 200
        assert vel_resp.json()["vision_eval"]["total_cases"] == 50

        eu_vel_dir = lakehouse / "gold" / "velocity_artifacts"
        if eu_vel_dir.exists():
            monkeypatch.setenv("VELOCITY_GOLD_DIR", str(eu_vel_dir))
            mbz_vel = await client.get(
                "/api/v1/portal/velocity",
                params={"top_k": 20, "brand_id": "Mercedes-Benz"},
            )
            assert mbz_vel.status_code == 200
            mbz_queue = mbz_vel.json()["breakout_queue"]
            assert len(mbz_queue) >= 1
            assert all(item["brand_id"] == "Mercedes-Benz" for item in mbz_queue)

        # 6. Asset ID filter, theme_label override, and Unverified / Other rejection
        cr_single = await client.get("/api/v1/portal/creatives", params={"asset_id": asset_id[:8], "limit": 5})
        assert cr_single.status_code == 200
        assert any(item["asset_id"] == asset_id for item in cr_single.json()["items"])
        assert "short_asset_id" in cr_single.json()["items"][0]

        before_verified = cr_single.json()["audit_summary"]["verified_assets"]
        theme_before = cr_single.json()["items"][0].get("theme_label") or "Unclustered"
        ov_theme = await client.post(
            "/api/v1/overrides",
            json={
                "target_key_type": "theme_label",
                "target_key_value": theme_before,
                "field_name": "theme_label",
                "human_value": "EV Charging Experience",
                "reviewer": "portal_qa",
                "reason": "Normalize theme taxonomy",
            },
        )
        assert ov_theme.status_code == 200
        cr_after_theme = await client.get("/api/v1/portal/creatives", params={"asset_id": asset_id, "limit": 5})
        assert cr_after_theme.json()["items"][0]["theme_label"] == "EV Charging Experience"

        ov_reject = await client.post(
            "/api/v1/overrides",
            json={
                "target_key_type": "asset_id",
                "target_key_value": asset_id,
                "field_name": "matched_brand_id",
                "human_value": "Unverified / Other",
                "reviewer": "portal_qa",
                "reason": "Dealer third-party clip",
            },
        )
        assert ov_reject.status_code == 200
        rej_data = ov_reject.json()
        assert rej_data["updated_items"][0]["belongs_to_brand"] is False
        assert rej_data["audit_summary"]["verified_assets"] == before_verified - 1

        # 7. Proxy MMM simulation loads distinct proxy curves when present and blocks ROAS
        import json

        bmw_dir = lakehouse / "gold" / "mmm_artifacts" / "BMW_DE"
        proxy_curves = json.loads((bmw_dir / "response_curves.json").read_text(encoding="utf-8"))
        proxy_curves["is_proxy_outcome"] = True
        proxy_curves["roas_claim_blocked"] = True
        proxy_curves["outcome_metric_name"] = "google_trends_index"
        proxy_curves["roi_label"] = "proxy_index_only"
        proxy_curves["channels"]["own_spend_youtube_usd"]["roas_mean"] = 1.111
        (bmw_dir / "response_curves_proxy.json").write_text(json.dumps(proxy_curves), encoding="utf-8")

        proxy_resp = await client.post(
            "/api/v1/mmm/simulate",
            json={"brand_id": "BMW", "country": "Germany", "panel_type": "google_trends_proxy"},
        )
        assert proxy_resp.status_code == 200
        proxy_json = proxy_resp.json()
        assert proxy_json["is_proxy_outcome"] is True
        assert proxy_json["roas_claim_blocked"] is True
        assert proxy_json["channels"]["own_spend_youtube_usd"]["roas_mean"] == pytest.approx(1.111)


@pytest.mark.asyncio
async def test_agent_tools_include_override_and_bq_country_iso_normalization(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from brand_analytics_app.agent import data_analyst_agent
    from brand_analytics_app.tools.bq_query import execute_bq_query
    from brand_analytics_app.tools.federated_intel import apply_creative_human_override

    tool_names = {getattr(t, "__name__", str(t)) for t in data_analyst_agent.tools}
    assert apply_creative_human_override.__name__ in tool_names

    monkeypatch.setenv("INTEGRATION_TEST", "TRUE")
    monkeypatch.setenv("DATA_BACKEND", "local")

    res = await execute_bq_query(
        start_date="2026-01-01",
        end_date="2026-03-31",
        target_countries=["DE", "United States"],
        include_keywords=["bmw"],
    )
    assert res["status"] == "success"
    assert res["row_count"] >= 2


def test_velocity_brand_filter_resolves_channel_subbrands(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import pandas as pd

    vel_dir = tmp_path / "gold_vel"
    vel_dir.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(
        [
            {"video_id": "v1", "channel_title": "BMW M", "is_predicted_breakout": True, "breakout_prob": 0.8},
            {"video_id": "v2", "channel_title": "Mercedes-AMG", "is_predicted_breakout": True, "breakout_prob": 0.7},
            {"video_id": "v3", "channel_title": "Audi Sport", "is_predicted_breakout": False, "breakout_prob": 0.2},
            {"video_id": "v4", "channel_title": "Porsche", "is_predicted_breakout": False, "breakout_prob": 0.1},
        ]
    ).to_parquet(vel_dir / "velocity_scores.parquet", index=False)

    monkeypatch.setenv("INTEL_LAKEHOUSE_DIR", str(tmp_path / "empty_lakehouse"))
    monkeypatch.setenv("VELOCITY_GOLD_DIR", str(vel_dir))

    bmw = get_velocity_breakout_alerts_and_ops(top_k=10, brand_id="BMW")
    assert bmw["total_scored_videos"] == 1
    assert bmw["predicted_breakouts"] == 1
    assert bmw["breakout_queue"][0]["video_id"] == "v1"
    assert bmw["breakout_queue"][0]["brand_id"] == "BMW"

    mbz = get_velocity_breakout_alerts_and_ops(top_k=10, brand_id="Mercedes-Benz")
    assert mbz["total_scored_videos"] == 1
    assert mbz["breakout_queue"][0]["brand_id"] == "Mercedes-Benz"

    missing = get_velocity_breakout_alerts_and_ops(top_k=10, brand_id="UnknownBrand")
    assert missing["total_scored_videos"] == 0
    assert missing["predicted_breakouts"] == 0
    assert missing["breakout_queue"] == []
