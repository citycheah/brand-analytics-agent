

from brand_analytics_app.tools import (
    _persist_and_summarize_verifications,
)


def test_persist_and_summarize_verifications_without_target_category() -> None:
    results = [
        {
            "url": "gs://bucket/ad1.png",
            "country": "Germany",
            "target_brand": "BMW",
            "matched_brand": "BMW",
            "belongs_to_brand": True,
            "category": "Automotive",
            "spend": 100.0,
            "impressions": 1000,
        },
        {
            "url": "gs://bucket/ad2.png",
            "country": "Germany",
            "target_brand": "BMW",
            "matched_brand": None,
            "belongs_to_brand": False,
            "category": "Food",
            "spend": 50.0,
            "impressions": 500,
        },
    ]

    summary_res = _persist_and_summarize_verifications(
        final_results=results, bq_data={}, target_category=None
    )

    assert summary_res["status"] == "success"
    assert "verifications_uri" in summary_res
    assert len(summary_res["summary"]) == 1

    item = summary_res["summary"][0]
    assert item["country"] == "Germany"
    assert item["brand"] == "BMW"
    assert item["total_checked"] == 2
    assert item["brand_matches"] == 1
    assert item["other_brand_ads"] == 1
    assert "total_passed" not in item
    assert "total_failed" not in item

    # Verified spend and impressions must strictly NOT appear in the summary
    assert "verified_spend" not in item
    assert "verified_impressions" not in item

    # Category match columns should not appear if target_category is None
    assert "category_matches" not in item
    assert "other_category" not in item


def test_persist_and_summarize_verifications_with_target_category() -> None:
    results = [
        {
            "url": "gs://bucket/ad1.png",
            "country": "Germany",
            "target_brand": "BMW",
            "matched_brand": "BMW",
            "belongs_to_brand": True,
            "category": "Automotive",
            "spend": 100.0,
            "impressions": 1000,
        },
        {
            "url": "gs://bucket/ad2.png",
            "country": "Germany",
            "target_brand": "BMW",
            "matched_brand": "BMW",
            "belongs_to_brand": True,
            "category": "Lifestyle",
            "spend": 80.0,
            "impressions": 800,
        },
        {
            "url": "gs://bucket/ad3.png",
            "country": "Germany",
            "target_brand": "BMW",
            "matched_brand": None,
            "belongs_to_brand": False,
            "category": "Automotive",
            "spend": 50.0,
            "impressions": 500,
        },
    ]

    summary_res = _persist_and_summarize_verifications(
        final_results=results, bq_data={}, target_category="Automotive"
    )

    assert summary_res["status"] == "success"
    assert summary_res.get("target_category") == "Automotive"
    assert len(summary_res["summary"]) == 1

    item = summary_res["summary"][0]
    assert item["country"] == "Germany"
    assert item["brand"] == "BMW"
    assert item["total_checked"] == 3
    assert item["category_matches"] == 1
    assert item["other_category"] == 1
    assert item["other_brand_ads"] == 1
    assert "total_passed" not in item
    assert "total_failed" not in item
    assert "brand_matches" not in item

    # Verified spend and impressions must strictly NOT appear in the summary
    assert "verified_spend" not in item
    assert "verified_impressions" not in item



