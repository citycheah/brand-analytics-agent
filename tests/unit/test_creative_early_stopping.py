import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from brand_analytics_app.tools import verify_creatives_multimodal


@pytest.mark.asyncio
async def test_verify_creatives_early_stopping() -> None:
    bq_data = [
        {
            "creative_url_supplier": "gs://bucket/bmw2.png",
            "spend": 200.0,
            "impressions": 2000,
            "advertiser_domain": "bmw.com",
            "matched_keywords": "bmw",
            "advertiser_name": "BMW AG",
            "creative_campaign_name": "BMW Drive",
        },
        {
            "creative_url_supplier": "gs://bucket/bmw1.png",
            "spend": 100.0,
            "impressions": 1000,
            "advertiser_domain": "bmw.com",
            "matched_keywords": "bmw",
            "advertiser_name": "BMW AG",
            "creative_campaign_name": "BMW Drive",
        },
        {
            "creative_url_supplier": "gs://bucket/merc1.png",
            "spend": 500.0,
            "impressions": 5000,
            "advertiser_domain": "mercedes.com",
            "matched_keywords": "mercedes",
            "advertiser_name": "Mercedes",
            "creative_campaign_name": "Merc Drive",
        },
    ]

    brand_keywords_map = {"BMW": ["bmw"], "Mercedes": ["mercedes"]}

    brand_domains_map = {"BMW": ["bmw.com"], "Mercedes": ["mercedes.com"]}

    # Disable INTEGRATION_TEST path to execute actual logic
    old_env = os.environ.get("INTEGRATION_TEST")
    os.environ["INTEGRATION_TEST"] = "FALSE"
    os.environ["VERIFY_CREATIVES_BATCH_SIZE"] = "1"

    mock_client_instance = MagicMock()
    mock_generate_content = AsyncMock()
    mock_client_instance.aio.models.generate_content = mock_generate_content

    # Mock response return values for successive Gemini calls
    response_bmw2 = MagicMock()
    response_bmw2.text = '[{"url": "gs://bucket/bmw2.png", "belongs_to_brand": true, "matched_brand": "BMW", "product": "BMW Car", "category": "Automotive", "explanation": "It is a BMW."}]'

    response_merc1 = MagicMock()
    response_merc1.text = '[{"url": "gs://bucket/merc1.png", "belongs_to_brand": true, "matched_brand": "Mercedes", "product": "Merc Car", "category": "Automotive", "explanation": "It is a Mercedes."}]'

    mock_generate_content.side_effect = [response_bmw2, response_merc1]

    try:
        with patch(
            "brand_analytics_app.tools.Client", return_value=mock_client_instance
        ):
            results = await verify_creatives_multimodal(
                bq_data=bq_data,
                brand_keywords_map=brand_keywords_map,
                brand_domains_map=brand_domains_map,
                target_category="Automotive",
                spend_threshold=150.0,
                impressions_threshold=1500,
            )
    finally:
        if "VERIFY_CREATIVES_BATCH_SIZE" in os.environ:
            del os.environ["VERIFY_CREATIVES_BATCH_SIZE"]
        if old_env is not None:
            os.environ["INTEGRATION_TEST"] = old_env
        else:
            del os.environ["INTEGRATION_TEST"]

    assert "verifications_uri" in results
    assert "summary" in results
    from brand_analytics_app.tools import _load_verifications_from_uri

    loaded_results = _load_verifications_from_uri(results["verifications_uri"])
    urls = [r["url"] for r in loaded_results]
    # bmw2 and merc1 should be verified. bmw1 should be skipped due to early stopping.
    assert "gs://bucket/bmw2.png" in urls
    assert "gs://bucket/merc1.png" in urls
    assert "gs://bucket/bmw1.png" not in urls
    assert mock_generate_content.call_count == 2

    # Assert new returned fields
    bmw2_res = next(r for r in loaded_results if r["url"] == "gs://bucket/bmw2.png")
    assert bmw2_res["spend"] == 200.0
    assert bmw2_res["impressions"] == 2000
    assert bmw2_res["matched_brand"] == "BMW"

    # Assert summary
    assert len(results["summary"]) > 0


@pytest.mark.asyncio
async def test_verify_creatives_domain_early_stopping() -> None:
    bq_data = [
        {
            "creative_url_supplier": "gs://bucket/bmw2.png",
            "spend": 200.0,
            "impressions": 2000,
            "advertiser_domain": "bmw.com",
            "matched_keywords": "bmw",
            "advertiser_name": "BMW AG",
            "creative_campaign_name": "BMW Drive",
        },
        {
            "creative_url_supplier": "gs://bucket/bmw1.png",
            "spend": 100.0,
            "impressions": 1000,
            "advertiser_domain": "bmw.com",
            "matched_keywords": "bmw",
            "advertiser_name": "BMW AG",
            "creative_campaign_name": "BMW Drive",
        },
    ]

    brand_keywords_map = {"BMW": ["bmw"]}

    brand_domains_map = {"BMW": ["bmw.com"]}

    old_env = os.environ.get("INTEGRATION_TEST")
    os.environ["INTEGRATION_TEST"] = "FALSE"
    os.environ["VERIFY_CREATIVES_BATCH_SIZE"] = "1"

    mock_client_instance = MagicMock()
    mock_generate_content = AsyncMock()
    mock_client_instance.aio.models.generate_content = mock_generate_content

    try:
        with patch(
            "brand_analytics_app.tools.Client", return_value=mock_client_instance
        ):
            results = await verify_creatives_multimodal(
                bq_data=bq_data,
                brand_keywords_map=brand_keywords_map,
                brand_domains_map=brand_domains_map,
                target_category=None,  # Enables domain pre-filtering
                spend_threshold=150.0,
                impressions_threshold=1500,
            )
    finally:
        if "VERIFY_CREATIVES_BATCH_SIZE" in os.environ:
            del os.environ["VERIFY_CREATIVES_BATCH_SIZE"]
        if old_env is not None:
            os.environ["INTEGRATION_TEST"] = old_env
        else:
            del os.environ["INTEGRATION_TEST"]

    assert "verifications_uri" in results
    assert "summary" in results
    from brand_analytics_app.tools import _load_verifications_from_uri

    loaded_results = _load_verifications_from_uri(results["verifications_uri"])
    urls = [r["url"] for r in loaded_results]
    # bmw2 should be auto-passed by domain, causing early stop, skipping bmw1
    assert "gs://bucket/bmw2.png" in urls
    assert "gs://bucket/bmw1.png" not in urls
    assert mock_generate_content.call_count == 0

    # Assert new returned fields
    bmw2_res = next(r for r in loaded_results if r["url"] == "gs://bucket/bmw2.png")
    assert bmw2_res["spend"] == 200.0
    assert bmw2_res["impressions"] == 2000
    assert bmw2_res["matched_brand"] == "BMW"


@pytest.mark.asyncio
async def test_verify_creatives_impossible_early_stopping() -> None:
    # All creatives have very small spend & impressions that can never meet the thresholds
    bq_data = [
        {
            "creative_url_supplier": "gs://bucket/bmw1.png",
            "spend": 10.0,
            "impressions": 100,
            "advertiser_domain": "bmw.com",
            "matched_keywords": "bmw",
            "advertiser_name": "BMW AG",
            "creative_campaign_name": "BMW Drive",
        },
        {
            "creative_url_supplier": "gs://bucket/bmw2.png",
            "spend": 5.0,
            "impressions": 50,
            "advertiser_domain": "bmw.com",
            "matched_keywords": "bmw",
            "advertiser_name": "BMW AG",
            "creative_campaign_name": "BMW Drive",
        },
    ]

    brand_keywords_map = {"BMW": ["bmw"]}

    brand_domains_map = {"BMW": ["bmw.com"]}

    old_env = os.environ.get("INTEGRATION_TEST")
    os.environ["INTEGRATION_TEST"] = "FALSE"
    os.environ["VERIFY_CREATIVES_BATCH_SIZE"] = "1"

    mock_client_instance = MagicMock()
    mock_generate_content = AsyncMock()
    mock_client_instance.aio.models.generate_content = mock_generate_content

    try:
        with patch(
            "brand_analytics_app.tools.Client", return_value=mock_client_instance
        ):
            results = await verify_creatives_multimodal(
                bq_data=bq_data,
                brand_keywords_map=brand_keywords_map,
                brand_domains_map=brand_domains_map,
                target_category="Automotive",  # Disables domain pre-filtering, so they would normally go to Gemini
                spend_threshold=100.0,
                impressions_threshold=1000,
            )
    finally:
        if "VERIFY_CREATIVES_BATCH_SIZE" in os.environ:
            del os.environ["VERIFY_CREATIVES_BATCH_SIZE"]
        if old_env is not None:
            os.environ["INTEGRATION_TEST"] = old_env
        else:
            del os.environ["INTEGRATION_TEST"]

    assert mock_generate_content.call_count == 0
    assert "verifications_uri" in results
    assert "summary" in results
    from brand_analytics_app.tools import _load_verifications_from_uri

    loaded_results = _load_verifications_from_uri(results["verifications_uri"])
    assert len(loaded_results) == 0


@pytest.mark.asyncio
async def test_verify_creatives_max_cap_slicing() -> None:
    # 150 creatives with impressions from 1 to 150
    bq_data = [
        {
            "creative_url_supplier": f"gs://bucket/bmw_{i}.png",
            "spend": 10.0,
            "impressions": i * 10,
            "advertiser_domain": "bmw.com",
            "matched_keywords": "bmw",
            "advertiser_name": "BMW AG",
            "creative_campaign_name": "BMW Drive",
        }
        for i in range(1, 151)
    ]

    brand_keywords_map = {"BMW": ["bmw"]}
    brand_domains_map = {"BMW": ["bmw.com"]}

    old_env = os.environ.get("INTEGRATION_TEST")
    os.environ["INTEGRATION_TEST"] = "FALSE"
    os.environ["MAX_CREATIVE_VERIFICATIONS_PER_BRAND"] = "20"
    os.environ["VERIFY_CREATIVES_BATCH_SIZE"] = "50"

    mock_client_instance = MagicMock()
    mock_generate_content = AsyncMock()
    mock_client_instance.aio.models.generate_content = mock_generate_content

    # Mock response returning belongs_to_brand: True for all creatives in chunk
    async def mock_gen(*args, **kwargs):
        resp = MagicMock()
        contents = kwargs.get("contents", [])
        prompt_text = contents[-1] if contents else ""
        import json
        import re
        urls = [
            u
            for u in re.findall(r'"url":\s*"([^"]+)"', prompt_text)
            if u.startswith("gs://")
        ]
        results = [
            {
                "url": u,
                "belongs_to_brand": True,
                "matched_brand": "BMW",
                "product": "Car",
                "category": "Automotive",
                "explanation": "Valid",
            }
            for u in urls
        ]
        resp.text = json.dumps(results)
        return resp

    mock_generate_content.side_effect = mock_gen

    try:
        with patch(
            "brand_analytics_app.tools.Client", return_value=mock_client_instance
        ):
            results = await verify_creatives_multimodal(
                bq_data=bq_data,
                brand_keywords_map=brand_keywords_map,
                brand_domains_map=brand_domains_map,
                target_category="Automotive",  # bypass domain filtering
                spend_threshold=500.0,  # 150 creatives have $1500 spend, top 20 only have $200 spend
                impressions_threshold=50000,  # 150 creatives have 113,250 impr, top 20 only have 28,100 impr
            )
    finally:
        if "MAX_CREATIVE_VERIFICATIONS_PER_BRAND" in os.environ:
            del os.environ["MAX_CREATIVE_VERIFICATIONS_PER_BRAND"]
        if "VERIFY_CREATIVES_BATCH_SIZE" in os.environ:
            del os.environ["VERIFY_CREATIVES_BATCH_SIZE"]
        if old_env is not None:
            os.environ["INTEGRATION_TEST"] = old_env
        else:
            del os.environ["INTEGRATION_TEST"]

    from brand_analytics_app.tools import _load_verifications_from_uri

    loaded_results = _load_verifications_from_uri(results["verifications_uri"])
    # Should be capped at 20 creatives
    assert len(loaded_results) == 20
    # And they should be the top 20 by impressions (impressions: 1500, 1490, ... down to 1310)
    top_urls = {f"gs://bucket/bmw_{i}.png" for i in range(131, 151)}
    actual_urls = {r["url"] for r in loaded_results}
    assert actual_urls == top_urls


def test_feasibility_html_renders_impressions_threshold() -> None:
    from brand_analytics_app.tools import generate_feasibility_report_html

    feasibility_data = {
        "BMW": {
            "spend": 50000.0,
            "impressions": 500000,
            "spend_threshold": 10000.0,
            "impressions_threshold": 100000,
            "is_feasible": True,
        }
    }

    html = generate_feasibility_report_html(
        country="Germany",
        feasibility_data=feasibility_data,
        creative_verifications=[],
        start_date="2026-01-01",
        end_date="2026-03-31",
    )

    assert "100,000" in html

