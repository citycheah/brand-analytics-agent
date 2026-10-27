from pathlib import Path

import pandas as pd
import pytest

from brand_analytics_app.tools import (
    calculate_brand_metrics,
    calculate_report_metrics,
    check_brand_feasibility,
    execute_bq_query,
)
from scripts.generate_synthetic_ad_data import generate_synthetic_dataset


def test_synthetic_generator_schema_and_determinism() -> None:
    df1 = generate_synthetic_dataset(seed=42)
    df2 = generate_synthetic_dataset(seed=42)

    assert len(df1) > 1000
    assert df1.equals(df2), "Synthetic generator must be deterministic for a fixed seed"

    expected_cols = {
        "month",
        "country",
        "advertiser_name",
        "advertiser_domain",
        "channel_name",
        "channel_group",
        "publisher_name",
        "publisher_group",
        "creative_campaign_name",
        "creative_url_supplier",
        "creative_id",
        "matched_keywords",
        "spend",
        "impressions",
    }
    assert expected_cols.issubset(set(df1.columns))
    assert {"GERMANY", "UNITED KINGDOM", "UNITED STATES", "SINGAPORE", "VIETNAM"} == set(
        df1["country"].unique()
    )


@pytest.mark.asyncio
async def test_local_backend_mode_end_to_end(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verifies DATA_BACKEND=local works end-to-end without BigQuery or GCS credentials."""
    monkeypatch.setenv("INTEGRATION_TEST", "FALSE")
    monkeypatch.setenv("DATA_BACKEND", "local")
    monkeypatch.setenv("LOCAL_STORAGE_DIR", str(tmp_path / "local_storage"))

    # Execute local query across Germany and Singapore
    query_res = await execute_bq_query(
        start_date="2026-01-01",
        end_date="2026-03-31",
        target_countries=["Germany", "Singapore"],
        include_keywords=["bmw", "bmw.de", "mercedes", "mercedes-benz.de"],
    )

    assert query_res["status"] == "success"
    assert query_res["row_count"] > 0
    assert query_res["gcs_uri"].startswith("file://")

    brand_keywords_map = {
        "Germany": {"BMW": ["bmw", "bmw.de"], "Mercedes-Benz": ["mercedes", "mercedes-benz.de"]},
        "Singapore": {"BMW": ["bmw"], "Mercedes-Benz": ["mercedes"]},
    }

    # Verify SOS/SOV metrics calculation on local partition directory
    metrics = calculate_brand_metrics(query_res, brand_keywords_map)
    assert metrics["status"] == "success"
    assert "Germany" in metrics
    assert metrics["Germany"]["Total"]["share_of_spend"] == 100.0

    # Verify feasibility evaluation on local partition directory
    feas = check_brand_feasibility(
        bq_data=query_res,
        brand_keywords_map=brand_keywords_map,
        start_date="2026-01-01",
        end_date="2026-03-31",
    )
    assert feas["status"] == "success"
    assert "is_feasible" in feas["Germany"]["BMW"]

    # Verify report metrics and chart pre-rendering
    rep = calculate_report_metrics(
        bq_data=query_res,
        brand_keywords_map=brand_keywords_map,
        report_type="comprehensive",
    )
    assert rep["status"] == "success"
    assert "report_cache_id" in rep
    assert "chart_html" in rep["Germany"]
