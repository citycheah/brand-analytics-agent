import pandas as pd
import pytest

from brand_analytics_app.tools import (
    calculate_brand_metrics,
    check_brand_feasibility,
    execute_bq_query,
)


@pytest.mark.asyncio
async def test_multi_market_execute_bq_query(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTEGRATION_TEST", "TRUE")

    res = await execute_bq_query(
        start_date="2025-01-01",
        end_date="2025-01-10",
        target_countries=["Germany", "United Kingdom"],
        include_keywords=["bmw", "bmw.de", "ford", "ford.co.uk"],
    )

    assert res["row_count"] > 0
    assert "gcs_uri" in res
    assert res["gcs_uri"].startswith("file://")


def test_multi_market_metrics_calculation() -> None:
    # 1. Setup mock query result rows
    bq_data = {"gcs_uri": "", "schema": [], "row_count": 4, "preview_rows": []}

    mock_df = pd.DataFrame(
        [
            {
                "country": "Germany",
                "matched_keywords": "bmw",
                "spend": 1000.0,
                "impressions": 10000,
            },
            {
                "country": "Germany",
                "matched_keywords": "mercedes",
                "spend": 2000.0,
                "impressions": 20000,
            },
            {
                "country": "United Kingdom",
                "matched_keywords": "ford",
                "spend": 5000.0,
                "impressions": 50000,
            },
            {
                "country": "United Kingdom",
                "matched_keywords": "bmw",
                "spend": 1500.0,
                "impressions": 15000,
            },
        ]
    )

    # Patch _load_query_results to return our mock dataframe
    import brand_analytics_app.tools

    original_load = brand_analytics_app.tools._load_query_results
    brand_analytics_app.tools._load_query_results = lambda x: mock_df

    try:
        brand_keywords_map = {
            "Germany": {"BMW": ["bmw"], "Mercedes": ["mercedes"]},
            "United Kingdom": {"Ford": ["ford"], "BMW": ["bmw"]},
        }

        metrics = calculate_brand_metrics(bq_data, brand_keywords_map)

        # Verify Germany metrics
        assert "Germany" in metrics
        assert metrics["Germany"]["BMW"]["spend"] == 1000.0
        assert metrics["Germany"]["BMW"]["share_of_spend"] == 33.33
        assert metrics["Germany"]["Mercedes"]["spend"] == 2000.0
        assert metrics["Germany"]["Mercedes"]["share_of_spend"] == 66.67

        # Verify UK metrics
        assert "United Kingdom" in metrics
        assert metrics["United Kingdom"]["Ford"]["spend"] == 5000.0
        assert metrics["United Kingdom"]["Ford"]["share_of_spend"] == 76.92
        assert metrics["United Kingdom"]["BMW"]["spend"] == 1500.0
        assert metrics["United Kingdom"]["BMW"]["share_of_spend"] == 23.08

    finally:
        brand_analytics_app.tools._load_query_results = original_load


def test_multi_market_feasibility_checking() -> None:
    bq_data = {"gcs_uri": "", "schema": [], "row_count": 4, "preview_rows": []}

    mock_df = pd.DataFrame(
        [
            {
                "country": "Germany",
                "matched_keywords": "bmw",
                "spend": 10000.0,
                "impressions": 700000,
            },
            {
                "country": "Germany",
                "matched_keywords": "mercedes",
                "spend": 200.0,
                "impressions": 1000,
            },
            {
                "country": "United Kingdom",
                "matched_keywords": "ford",
                "spend": 20000.0,
                "impressions": 1000000,
            },
        ]
    )

    import brand_analytics_app.tools

    original_load = brand_analytics_app.tools._load_query_results
    brand_analytics_app.tools._load_query_results = lambda x: mock_df

    try:
        brand_keywords_map = {
            "Germany": {"BMW": ["bmw"], "Mercedes": ["mercedes"]},
            "United Kingdom": {"Ford": ["ford"]},
        }

        # Base thresholds default to 7500 spend and 300000 impressions
        feasibility = check_brand_feasibility(
            bq_data=bq_data,
            brand_keywords_map=brand_keywords_map,
            start_date="2026-01-01",
            end_date="2026-03-31",  # exactly 3 months (90 days) -> scale factor 1.0
        )

        assert "Germany" in feasibility
        assert feasibility["Germany"]["BMW"]["is_feasible"] is True
        assert feasibility["Germany"]["Mercedes"]["is_feasible"] is False

        assert "United Kingdom" in feasibility
        assert feasibility["United Kingdom"]["Ford"]["is_feasible"] is True

    finally:
        brand_analytics_app.tools._load_query_results = original_load
