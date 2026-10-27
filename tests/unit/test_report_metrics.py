import pandas as pd

from brand_analytics_app.tools import (
    _attribute_data_to_brands,
    _calculate_brand_totals,
    _calculate_channel_breakdowns,
    _calculate_creative_data,
    _calculate_monthly_trends,
    _calculate_publisher_data,
    calculate_report_metrics,
)


def test_attribute_data_to_brands() -> None:
    bq_mock = [
        {
            "matched_keywords": "bmw",
            "spend": 1000.0,
            "impressions": 50000,
            "month": "2026-01-01",
        },
        {
            "matched_keywords": "bmw, mercedes",
            "spend": 2000.0,
            "impressions": 100000,
            "month": "2026-01-01",
        },
    ]
    brands_map = {"BMW": ["bmw"], "Mercedes": ["mercedes"]}

    df = pd.DataFrame(bq_mock)
    attributed = _attribute_data_to_brands(df, brands_map)

    # Check shape
    # Row 1 splits to BMW only (spend=1000.0)
    # Row 2 splits to BMW and Mercedes (spend=1000.0 each)
    # Total BMW spend should be 2000.0, Mercedes spend 1000.0
    bmw_rows = attributed[attributed["brand"] == "BMW"]
    mercedes_rows = attributed[attributed["brand"] == "Mercedes"]

    assert len(bmw_rows) == 2
    assert len(mercedes_rows) == 1
    assert bmw_rows["spend"].sum() == 2000.0
    assert mercedes_rows["spend"].sum() == 1000.0


def test_calculate_brand_totals() -> None:
    country_df = pd.DataFrame(
        [
            {
                "brand": "BMW",
                "spend": 1000.0,
                "impressions": 50000,
                "matched_keywords": "bmw",
            },
            {
                "brand": "Mercedes",
                "spend": 3000.0,
                "impressions": 150000,
                "matched_keywords": "mercedes",
            },
        ]
    )
    brands_map = {"BMW": ["bmw"], "Mercedes": ["mercedes"]}

    totals = _calculate_brand_totals(country_df, brands_map)

    assert totals["BMW"]["spend"] == 1000.0
    assert totals["BMW"]["share_of_spend"] == 25.0
    assert totals["Total"]["spend"] == 4000.0
    assert totals["Total"]["share_of_spend"] == 100.0


def test_calculate_report_metrics_dynamic() -> None:
    bq_mock = [
        {
            "matched_keywords": "bmw",
            "spend": 1000.0,
            "impressions": 50000,
            "month": "2026-01-01",
            "channel_name": "Social",
            "publisher_name": "Instagram",
            "creative_id": "cr1",
        },
        {
            "matched_keywords": "bmw",
            "spend": 2000.0,
            "impressions": 100000,
            "month": "2026-02-01",
            "channel_name": "Social",
            "publisher_name": "Instagram",
            "creative_id": "cr2",
        },
        {
            "matched_keywords": "mercedes",
            "spend": 3000.0,
            "impressions": 150000,
            "month": "2026-01-01",
            "channel_name": "Video",
            "publisher_name": "YouTube",
            "creative_id": "cr3",
        },
    ]

    brand_keywords_map = {"BMW": ["bmw"], "Mercedes": ["mercedes"]}

    # Dynamic Report should pre-compute ALL metrics and charts
    results = calculate_report_metrics(bq_mock, brand_keywords_map, "dynamic")

    # Overall totals
    assert results["brand_totals"]["BMW"]["spend"] == 3000.0
    assert results["brand_totals"]["Mercedes"]["spend"] == 3000.0

    # Monthly trends
    assert len(results["monthly_trends"]["BMW"]) == 2

    # Channel breakdowns
    assert results["channel_breakdown"]["BMW"]["Social"]["spend"] == 3000.0

    # Publisher matrix (cap is 5 for dynamic)
    assert len(results["publisher_matrix_spend"]) == 2

    # Unique creatives
    assert results["unique_creatives"]["BMW"] == 2

    # Verify all expected chart keys are pre-rendered in chart_html
    assert "spend_trend" in results["chart_html"]
    assert "impressions_trend" in results["chart_html"]
    assert "sos_trend" in results["chart_html"]
    assert "sov_trend" in results["chart_html"]
    assert "channel_spend_mix" in results["chart_html"]
    assert "channel_impressions_mix" in results["chart_html"]
    assert "publisher_count_bar" in results["chart_html"]
    assert "channel_creative_mix" in results["chart_html"]


def test_calculate_report_metrics_trends() -> None:
    bq_mock = [
        {
            "matched_keywords": "bmw",
            "spend": 1000.0,
            "impressions": 50000,
            "month": "2026-01-01",
            "channel_name": "Social",
            "publisher_name": "Instagram",
            "creative_id": "cr1",
        },
        {
            "matched_keywords": "bmw",
            "spend": 2000.0,
            "impressions": 100000,
            "month": "2026-02-01",
            "channel_name": "Social",
            "publisher_name": "Instagram",
            "creative_id": "cr2",
        },
        {
            "matched_keywords": "mercedes",
            "spend": 3000.0,
            "impressions": 150000,
            "month": "2026-01-01",
            "channel_name": "Video",
            "publisher_name": "YouTube",
            "creative_id": "cr3",
        },
    ]

    brand_keywords_map = {"BMW": ["bmw"], "Mercedes": ["mercedes"]}

    results = calculate_report_metrics(bq_mock, brand_keywords_map, "trends_sos_sov")

    assert results["brand_totals"]["BMW"]["spend"] == 3000.0
    assert len(results["monthly_trends"]["BMW"]) == 2
    assert "spend_trend" in results["chart_html"]

    # Publisher & creative data should be empty/default since report_type is trends only
    assert not results["unique_creatives"]
    assert not results["publisher_matrix_spend"]


def test_calculate_report_metrics_channel_group() -> None:
    bq_mock = [
        {
            "matched_keywords": "bmw",
            "spend": 1000.0,
            "impressions": 50000,
            "month": "2026-01-01",
            "channel_name": "Social",
            "publisher_name": "Instagram",
            "creative_id": "cr1",
        },
        {
            "matched_keywords": "bmw",
            "spend": 2000.0,
            "impressions": 100000,
            "month": "2026-02-01",
            "channel_name": "Video",
            "publisher_name": "YouTube",
            "creative_id": "cr2",
        },
    ]
    brand_keywords_map = {"BMW": ["bmw"]}

    results = calculate_report_metrics(bq_mock, brand_keywords_map, "channel_group")

    assert results["channel_breakdown"]["BMW"]["Social"]["spend"] == 1000.0
    assert results["channel_breakdown"]["BMW"]["Video"]["spend"] == 2000.0
    assert "channel_spend_mix" in results["chart_html"]

    # Trends and publishers should be empty
    assert not results["monthly_trends"]
    assert not results["publisher_counts"]


def test_calculate_report_metrics_publisher() -> None:
    bq_mock = [
        {
            "matched_keywords": "bmw",
            "spend": 1000.0,
            "impressions": 50000,
            "month": "2026-01-01",
            "channel_name": "Social",
            "publisher_name": "Instagram",
            "creative_id": "cr1",
        },
        {
            "matched_keywords": "bmw",
            "spend": 2000.0,
            "impressions": 100000,
            "month": "2026-02-01",
            "channel_name": "Social",
            "publisher_name": "Facebook",
            "creative_id": "cr2",
        },
    ]
    brand_keywords_map = {"BMW": ["bmw"]}

    results = calculate_report_metrics(bq_mock, brand_keywords_map, "publisher")

    assert results["publisher_counts"]["BMW"] == 2
    assert "publisher_count_bar" in results["chart_html"]

    spend_matrix = results["publisher_matrix_spend"]
    assert len(spend_matrix) == 2
    pub_names = {row["Publisher Name"] for row in spend_matrix}
    assert "Instagram" in pub_names
    assert "Facebook" in pub_names


def test_calculate_monthly_trends_direct() -> None:
    country_df = pd.DataFrame(
        [
            {
                "brand": "BMW",
                "spend": 1000.0,
                "impressions": 50000,
                "month": "2026-01-01",
            },
            {
                "brand": "BMW",
                "spend": 2000.0,
                "impressions": 100000,
                "month": "2026-02-01",
            },
        ]
    )
    brands_map = {"BMW": ["bmw"]}

    monthly_trends, _monthly_shares, num_months, chart_html = _calculate_monthly_trends(
        country_df, brands_map
    )

    assert num_months == 2
    assert len(monthly_trends["BMW"]) == 2
    assert monthly_trends["BMW"][0]["spend"] == 1000.0
    assert monthly_trends["BMW"][1]["spend"] == 2000.0
    assert "spend_trend" in chart_html


def test_calculate_channel_breakdowns_direct() -> None:
    country_df = pd.DataFrame(
        [
            {
                "brand": "BMW",
                "spend": 1000.0,
                "impressions": 50000,
                "channel_group": "Social",
            },
            {
                "brand": "BMW",
                "spend": 2000.0,
                "impressions": 100000,
                "channel_group": "Video",
            },
        ]
    )
    brands_map = {"BMW": ["bmw"]}

    channel_breakdown, chart_html = _calculate_channel_breakdowns(
        country_df, brands_map
    )

    assert channel_breakdown["BMW"]["Social"]["spend"] == 1000.0
    assert channel_breakdown["BMW"]["Video"]["spend"] == 2000.0
    assert "channel_spend_mix" in chart_html


def test_calculate_publisher_data_direct() -> None:
    country_df = pd.DataFrame(
        [
            {
                "brand": "BMW",
                "spend": 1000.0,
                "impressions": 50000,
                "publisher_name": "Instagram",
            },
            {
                "brand": "BMW",
                "spend": 2000.0,
                "impressions": 100000,
                "publisher_name": "Facebook",
            },
        ]
    )
    brands_map = {"BMW": ["bmw"]}

    pub_counts, pub_m_spend, _pub_m_impr, chart_html = _calculate_publisher_data(
        country_df, brands_map, matrix_cap=5
    )

    assert pub_counts["BMW"] == 2
    assert len(pub_m_spend) == 2
    assert "publisher_count_bar" in chart_html


def test_calculate_creative_data_direct() -> None:
    country_df = pd.DataFrame(
        [
            {
                "brand": "BMW",
                "spend": 1000.0,
                "impressions": 50000,
                "creative_id": "cr1",
                "channel_group": "Social",
            },
            {
                "brand": "BMW",
                "spend": 2000.0,
                "impressions": 100000,
                "creative_id": "cr2",
                "channel_group": "Social",
            },
        ]
    )
    brands_map = {"BMW": ["bmw"]}

    unique_creatives, creative_channel_mix, chart_html = _calculate_creative_data(
        country_df, brands_map
    )

    assert unique_creatives["BMW"] == 2
    assert creative_channel_mix["BMW"]["Social"] == 2
    assert "channel_creative_mix" in chart_html
