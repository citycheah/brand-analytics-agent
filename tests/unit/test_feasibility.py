import json

import pytest

from brand_analytics_app.tools import check_brand_feasibility, get_feasibility_defaults


def test_feasibility_defaults_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    # Test Germany fallback
    spend_de, imp_de = get_feasibility_defaults("germany")
    assert spend_de == 4500.0
    assert imp_de == 600000

    # Test global fallback
    spend_glob, imp_glob = get_feasibility_defaults("unknown_country")
    assert spend_glob == 4500.0
    assert imp_glob == 600000

    # Test environment variable overrides
    monkeypatch.setenv(
        "FEASIBILITY_THRESHOLDS_JSON",
        json.dumps(
            {
                "france": {"spend": 5000, "impressions": 200000},
                "default": {"spend": 6000, "impressions": 250000},
            }
        ),
    )

    spend_fr, imp_fr = get_feasibility_defaults("france")
    assert spend_fr == 5000.0
    assert imp_fr == 200000

    spend_def, imp_def = get_feasibility_defaults("default")
    assert spend_def == 6000.0
    assert imp_def == 250000


def test_feasibility_ceiling_month_scaling() -> None:
    # 90 days -> 3 ceiling months -> 3 / 3 = 1.0 scaling
    res_90 = check_brand_feasibility(
        bq_data=[],
        brand_keywords_map={"BMW": ["bmw"]},
        spend_threshold=7500.0,
        impressions_threshold=300000,
        start_date="2026-01-01",
        end_date="2026-04-01",
    )
    assert res_90["BMW"]["spend_threshold"] == 7500.0
    assert res_90["BMW"]["impressions_threshold"] == 300000

    # 75 days -> 2.5 months -> round to 2 months -> 2 / 3 = 0.667 scaling
    res_75 = check_brand_feasibility(
        bq_data=[],
        brand_keywords_map={"BMW": ["bmw"]},
        spend_threshold=7500.0,
        impressions_threshold=300000,
        start_date="2026-01-01",
        end_date="2026-03-17",
    )
    assert res_75["BMW"]["spend_threshold"] == 5000.0
    assert res_75["BMW"]["impressions_threshold"] == 200000

    # 15 days -> 1 ceiling month -> 1 / 3 = 0.33 scaling
    res_15 = check_brand_feasibility(
        bq_data=[],
        brand_keywords_map={"BMW": ["bmw"]},
        spend_threshold=7500.0,
        impressions_threshold=300000,
        start_date="2026-01-01",
        end_date="2026-01-16",
    )
    assert round(res_15["BMW"]["spend_threshold"], 2) == 2500.0
    assert res_15["BMW"]["impressions_threshold"] == 100000

    # 180 days -> 6 ceiling months -> 6 / 3 = 2.0 scaling
    res_180 = check_brand_feasibility(
        bq_data=[],
        brand_keywords_map={"BMW": ["bmw"]},
        spend_threshold=7500.0,
        impressions_threshold=300000,
        start_date="2026-01-01",
        end_date="2026-06-30",
    )
    assert res_180["BMW"]["spend_threshold"] == 15000.0
    assert res_180["BMW"]["impressions_threshold"] == 600000


def test_feasibility_creative_verification_filtering() -> None:
    # Mock data with two ads: one real Dior ad, one fake cheap perfumes ad
    bq_mock = [
        {
            "creative_url_supplier": "https://creative-assets.dior.com/fashion_show.png",
            "matched_keywords": "dior",
            "spend": 5000.0,
            "impressions": 200000,
        },
        {
            "creative_url_supplier": "https://cheap-perfumes-online.com/dior_ad.png",
            "matched_keywords": "dior",
            "spend": 4000.0,
            "impressions": 150000,
        },
    ]

    creative_verifications = [
        {
            "url": "https://creative-assets.dior.com/fashion_show.png",
            "belongs_to_brand": True,
            "category": "Fashion",
        },
        {
            "url": "https://cheap-perfumes-online.com/dior_ad.png",
            "belongs_to_brand": False,  # Flagged as fake / not belonging to brand
            "category": "Beauty",
        },
    ]

    # Without creative verification, total spend is 5000 + 4000 = 9000 (feasible)
    res_without = check_brand_feasibility(
        bq_data=bq_mock,
        brand_keywords_map={"Dior": ["dior"]},
        spend_threshold=7500.0,
        impressions_threshold=300000,
        start_date="2026-01-01",
        end_date="2026-04-01",
    )
    assert res_without["Dior"]["spend"] == 9000.0
    assert res_without["Dior"]["is_feasible"] is True

    # With creative verification, the second ad is excluded, spend is 5000 (not feasible)
    res_with = check_brand_feasibility(
        bq_data=bq_mock,
        brand_keywords_map={"Dior": ["dior"]},
        spend_threshold=7500.0,
        impressions_threshold=300000,
        start_date="2026-01-01",
        end_date="2026-04-01",
        creative_verifications=creative_verifications,
    )
    assert res_with["Dior"]["spend"] == 5000.0
    assert res_with["Dior"]["is_feasible"] is False

    # Category filter: keeping only 'Fashion' (spend is 5000, feasible if threshold is e.g. 4000)
    res_category = check_brand_feasibility(
        bq_data=bq_mock,
        brand_keywords_map={"Dior": ["dior"]},
        spend_threshold=4000.0,
        impressions_threshold=100000,
        start_date="2026-01-01",
        end_date="2026-04-01",
        creative_verifications=creative_verifications,
        target_category="Fashion",
    )
    assert res_category["Dior"]["spend"] == 5000.0
    assert res_category["Dior"]["is_feasible"] is True

    # Category filter: keeping 'Beauty' (all fashion ads excluded, spend is 0, not feasible)
    res_beauty = check_brand_feasibility(
        bq_data=bq_mock,
        brand_keywords_map={"Dior": ["dior"]},
        spend_threshold=4000.0,
        impressions_threshold=100000,
        start_date="2026-01-01",
        end_date="2026-04-01",
        creative_verifications=creative_verifications,
        target_category="Beauty",
    )
    # The Beauty ad is belongs_to_brand=False, so it is excluded.
    # The Fashion ad has category=Fashion, so it is excluded by target_category=Beauty.
    # So spend is 0.
    assert res_beauty["Dior"]["spend"] == 0.0
    assert res_beauty["Dior"]["is_feasible"] is False


def test_feasibility_with_verifications_uri(tmp_path) -> None:
    """Verifies that check_brand_feasibility accepts verifications via URI (dict or string)."""
    bq_mock = [
        {
            "country": "France",
            "matched_keywords": "dior",
            "spend": 5000.0,
            "impressions": 100000,
            "creative_url_supplier": "https://ad.com/dior1.png",
        },
    ]
    creative_verifications = [
        {
            "url": "https://ad.com/dior1.png",
            "country": "France",
            "belongs_to_brand": True,
            "matched_brand": "Dior",
            "category": "Fashion",
            "spend": 5000.0,
            "impressions": 100000,
        }
    ]

    import json

    json_file = tmp_path / "creative_verifications.json"
    json_file.write_text(json.dumps(creative_verifications))
    file_uri = f"file://{json_file}"

    # Test 1: passing dict with verifications_uri
    res_dict = check_brand_feasibility(
        bq_data=bq_mock,
        brand_keywords_map={"Dior": ["dior"]},
        spend_threshold=4000.0,
        impressions_threshold=50000,
        start_date="2026-01-01",
        end_date="2026-04-01",
        creative_verifications={"verifications_uri": file_uri},
    )
    assert res_dict["Dior"]["spend"] == 5000.0
    assert res_dict["Dior"]["is_feasible"] is True

    # Test 2: passing raw URI string
    res_str = check_brand_feasibility(
        bq_data=bq_mock,
        brand_keywords_map={"Dior": ["dior"]},
        spend_threshold=4000.0,
        impressions_threshold=50000,
        start_date="2026-01-01",
        end_date="2026-04-01",
        creative_verifications=file_uri,
    )
    assert res_str["Dior"]["spend"] == 5000.0
    assert res_str["Dior"]["is_feasible"] is True


def test_load_query_results_str_and_verifications_as_bq_data(tmp_path) -> None:
    """Verifies that _load_query_results and check_brand_feasibility accept string bq_data and verifications."""
    from brand_analytics_app.tools import _load_query_results

    # 1. Test JSON string
    json_str = '[{"brand": "BMW", "spend": 100.0, "impressions": 1000}]'
    df_json = _load_query_results(json_str)
    assert len(df_json) == 1
    assert df_json.iloc[0]["spend"] == 100.0

    # 2. Test JSON file URI
    verifications = [
        {
            "url": "https://ad.com/dior1.png",
            "country": "France",
            "belongs_to_brand": True,
            "matched_brand": "Dior",
            "matched_keywords": "dior",
            "category": "Fashion",
            "spend": 5000.0,
            "impressions": 100000,
        }
    ]
    import json
    json_file = tmp_path / "test_verifications.json"
    json_file.write_text(json.dumps(verifications))
    file_uri = f"file://{json_file}"

    df_file = _load_query_results(file_uri)
    assert len(df_file) == 1
    assert df_file.iloc[0]["spend"] == 5000.0

    # 3. Test check_brand_feasibility when bq_data is the verification JSON file URI string
    res_uri = check_brand_feasibility(
        bq_data=file_uri,
        brand_keywords_map={"France": {"Dior": ["dior"]}},
        spend_threshold=4000.0,
        impressions_threshold=50000,
        start_date="2026-01-01",
        end_date="2026-04-01",
    )
    assert res_uri["France"]["Dior"]["spend"] == 5000.0
    assert res_uri["France"]["Dior"]["is_feasible"] is True

    # 4. Test check_brand_feasibility when bq_data is the verification dict
    res_dict = check_brand_feasibility(
        bq_data={"verifications_uri": file_uri},
        brand_keywords_map={"France": {"Dior": ["dior"]}},
        spend_threshold=4000.0,
        impressions_threshold=50000,
        start_date="2026-01-01",
        end_date="2026-04-01",
    )
    assert res_dict["France"]["Dior"]["spend"] == 5000.0
    assert res_dict["France"]["Dior"]["is_feasible"] is True

