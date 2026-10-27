import json
from pathlib import Path

from brand_analytics_app.tools import check_brand_feasibility


def test_cross_brand_keyword_mismatch_and_split_factor_preservation() -> None:
    """A BQ row matches Brand A ('Dior') and Brand B ('Chanel') keywords.

    Verification confirms the creative belongs to 'Chanel'.
    'Chanel' must receive 100% of the spend, and 'Dior' must receive 0%.
    """
    bq_mock = [
        {
            "creative_url_supplier": "https://ads.com/chanel_perfume.png",
            "matched_keywords": "dior, chanel",
            "spend": 1000.0,
            "impressions": 50000,
        }
    ]

    creative_verifications = [
        {
            "url": "https://ads.com/chanel_perfume.png",
            "belongs_to_brand": True,
            "matched_brand": "Chanel",
            "category": "Beauty",
        }
    ]

    res = check_brand_feasibility(
        bq_data=bq_mock,
        brand_keywords_map={
            "Dior": ["dior"],
            "Chanel": ["chanel"],
        },
        spend_threshold=500.0,
        impressions_threshold=20000,
        start_date="2026-01-01",
        end_date="2026-04-01",
        creative_verifications=creative_verifications,
    )

    assert res["Dior"]["spend"] == 0.0
    assert res["Dior"]["impressions"] == 0
    assert res["Dior"]["is_feasible"] is False

    # Chanel gets 100% of the spend ($1000) rather than losing half ($500)
    assert res["Chanel"]["spend"] == 1000.0
    assert res["Chanel"]["impressions"] == 50000
    assert res["Chanel"]["is_feasible"] is True


def test_category_mismatch_with_target_category() -> None:
    """A creative belongs to 'Dior' with category 'Beauty', but target_category is 'Fashion'.

    The spend must NOT be credited to Dior.
    """
    bq_mock = [
        {
            "creative_url_supplier": "https://ads.com/dior_sauvage.png",
            "matched_keywords": "dior",
            "spend": 2000.0,
            "impressions": 100000,
        }
    ]

    creative_verifications = [
        {
            "url": "https://ads.com/dior_sauvage.png",
            "belongs_to_brand": True,
            "matched_brand": "Dior",
            "category": "Beauty",
        }
    ]

    res = check_brand_feasibility(
        bq_data=bq_mock,
        brand_keywords_map={"Dior": ["dior"]},
        spend_threshold=1000.0,
        impressions_threshold=50000,
        start_date="2026-01-01",
        end_date="2026-04-01",
        creative_verifications=creative_verifications,
        target_category="Fashion",
    )

    assert res["Dior"]["spend"] == 0.0
    assert res["Dior"]["impressions"] == 0
    assert res["Dior"]["is_feasible"] is False


def test_brand_only_match_without_target_category() -> None:
    """When target_category is None, any creative matching the brand is credited."""
    bq_mock = [
        {
            "creative_url_supplier": "https://ads.com/dior_general.png",
            "matched_keywords": "dior",
            "spend": 3000.0,
            "impressions": 150000,
        }
    ]

    creative_verifications = [
        {
            "url": "https://ads.com/dior_general.png",
            "belongs_to_brand": True,
            "matched_brand": "Dior",
            "category": "Beauty",
        }
    ]

    res = check_brand_feasibility(
        bq_data=bq_mock,
        brand_keywords_map={"Dior": ["dior"]},
        spend_threshold=2000.0,
        impressions_threshold=100000,
        start_date="2026-01-01",
        end_date="2026-04-01",
        creative_verifications=creative_verifications,
        target_category=None,
    )

    assert res["Dior"]["spend"] == 3000.0
    assert res["Dior"]["impressions"] == 150000
    assert res["Dior"]["is_feasible"] is True


def test_auto_extract_target_category_from_dict(tmp_path: Path) -> None:
    """If target_category is passed inside the creative_verifications dict, it should be used."""
    bq_mock = [
        {
            "creative_url_supplier": "https://ads.com/dior_sauvage.png",
            "matched_keywords": "dior",
            "spend": 2000.0,
            "impressions": 100000,
        }
    ]

    verifications = [
        {
            "url": "https://ads.com/dior_sauvage.png",
            "belongs_to_brand": True,
            "matched_brand": "Dior",
            "category": "Beauty",
        }
    ]

    json_file = tmp_path / "creative_verifications.json"
    json_file.write_text(json.dumps(verifications))
    file_uri = f"file://{json_file}"

    # Target category passed inside the dict as 'Fashion'
    ver_dict = {
        "verifications_uri": file_uri,
        "target_category": "Fashion",
    }

    res = check_brand_feasibility(
        bq_data=bq_mock,
        brand_keywords_map={"Dior": ["dior"]},
        spend_threshold=1000.0,
        impressions_threshold=50000,
        start_date="2026-01-01",
        end_date="2026-04-01",
        creative_verifications=ver_dict,
        target_category=None,
    )

    # Since ad is Beauty and target_category was extracted as Fashion, Dior should get 0 spend
    assert res["Dior"]["spend"] == 0.0
    assert res["Dior"]["impressions"] == 0
    assert res["Dior"]["is_feasible"] is False
