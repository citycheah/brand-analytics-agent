from brand_analytics_app.tools import calculate_brand_metrics


def test_metrics_calculation_basic() -> None:
    bq_mock = [
        {"matched_keywords": "bmw", "spend": 1000.0, "impressions": 50000},
        {"matched_keywords": "mercedes", "spend": 3000.0, "impressions": 150000},
    ]

    brand_keywords_map = {"BMW": ["bmw"], "Mercedes-Benz": ["mercedes"]}

    results = calculate_brand_metrics(bq_mock, brand_keywords_map)

    # Validate BMW metrics
    assert results["BMW"]["spend"] == 1000.0
    assert results["BMW"]["impressions"] == 50000
    assert results["BMW"]["share_of_spend"] == 25.0
    assert results["BMW"]["share_of_impressions"] == 25.0

    # Validate Mercedes metrics
    assert results["Mercedes-Benz"]["spend"] == 3000.0
    assert results["Mercedes-Benz"]["impressions"] == 150000
    assert results["Mercedes-Benz"]["share_of_spend"] == 75.0
    assert results["Mercedes-Benz"]["share_of_impressions"] == 75.0

    # Validate Total
    assert results["Total"]["spend"] == 4000.0
    assert results["Total"]["impressions"] == 200000
    assert results["Total"]["share_of_spend"] == 100.0
    assert results["Total"]["share_of_impressions"] == 100.0


def test_metrics_comention_division() -> None:
    bq_mock = [
        {"matched_keywords": "bmw, mercedes", "spend": 1000.0, "impressions": 30000}
    ]

    brand_keywords_map = {"BMW": ["bmw"], "Mercedes-Benz": ["mercedes"]}

    results = calculate_brand_metrics(bq_mock, brand_keywords_map)

    # Validate comention splits (50% each)
    assert results["BMW"]["spend"] == 500.0
    assert results["BMW"]["impressions"] == 15000
    assert results["BMW"]["share_of_spend"] == 50.0
    assert results["BMW"]["share_of_impressions"] == 50.0

    assert results["Mercedes-Benz"]["spend"] == 500.0
    assert results["Mercedes-Benz"]["impressions"] == 15000
    assert results["Mercedes-Benz"]["share_of_spend"] == 50.0
    assert results["Mercedes-Benz"]["share_of_impressions"] == 50.0
