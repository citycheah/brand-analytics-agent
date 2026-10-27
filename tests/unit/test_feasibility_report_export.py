from unittest.mock import patch

import pytest

from brand_analytics_app.tools import (
    export_feasibility_report,
    generate_feasibility_report_html,
)


def test_generate_feasibility_report_html() -> None:
    feasibility_data = {
        "BMW": {
            "is_feasible": True,
            "status_text": "Sufficient Data",
            "spend": 6370.0,
            "impressions": 332838,
            "spend_threshold": 5000.0,
            "impr_threshold": 100000,
        },
        "Mercedes": {
            "is_feasible": False,
            "status_text": "Insufficient Data",
            "spend": 1000.0,
            "impressions": 50000,
            "spend_threshold": 5000.0,
            "impr_threshold": 100000,
        },
    }

    creative_verifications = [
        {
            "url": "https://test.com/img1.png",
            "matched_brand": "BMW",
            "category": "Automotive",
            "product": "X5",
            "spend": 1000.0,
            "impressions": 50000,
            "explanation": "Car is shown",
        }
    ]

    html = generate_feasibility_report_html(
        country="Germany",
        feasibility_data=feasibility_data,
        creative_verifications=creative_verifications,
        start_date="2026-01-01",
        end_date="2026-01-31",
        target_category="Automotive",
    )

    assert "Feasibility & Creative Verification - Germany" in html
    assert "Brands Analyzed" in html
    assert "2</p>" in html  # 2 brands
    assert "$7,370" in html  # Total spend 6370 + 1000
    assert "382,838" in html  # Total impressions 332838 + 50000
    assert "BMW" in html
    assert "$6,370" in html
    assert "332,838" in html
    assert "Mercedes" in html
    assert "https://test.com/img1.png" in html
    assert "X5" in html


@pytest.mark.asyncio
async def test_export_feasibility_report_tool() -> None:
    # Test that sorting and filtering logic works
    feasibility_data = {
        "status": "success",
        "BMW": {
            "is_feasible": True,
            "spend": 1000,
            "impressions": 1000,
        }
    }

    creatives = [
        {
            "url": "ad_other_cat.png",
            "country": "Germany",
            "belongs_to_brand": True,
            "category": "Lifestyle",
            "impressions": 10000,
        },
        {
            "url": "ad_target_cat_low.png",
            "country": "Germany",
            "belongs_to_brand": True,
            "category": "Automotive",
            "impressions": 500,
        },
        {
            "url": "ad_target_cat_high.png",
            "country": "Germany",
            "belongs_to_brand": True,
            "category": "Automotive",
            "impressions": 2000,
        },
        {
            "url": "ad_failed.png",
            "country": "Germany",
            "belongs_to_brand": False,
            "category": "Automotive",
            "impressions": 50000,
        },
        {
            "url": "ad_france.png",
            "country": "France",
            "belongs_to_brand": True,
            "category": "Automotive",
            "impressions": 50000,
        }
    ]

    with patch(
        "brand_analytics_app.tools.export_report",
        autospec=True,
        return_value={
            "status": "success",
            "html_file_uri": "gs://bucket/feasibility.html"
        }
    ) as mock_export:
        res = await export_feasibility_report(
            country="Germany",
            feasibility_data=feasibility_data,
            creative_verifications=creatives,
            start_date="2026-01-01",
            end_date="2026-01-31",
            target_category="Automotive",
        )

        assert res["status"] == "success"
        assert res["html_file_uri"] == "gs://bucket/feasibility.html"

        # Verify export_report was called with correct HTML content
        mock_export.assert_called_once()
        call_args = mock_export.call_args[1]
        html_content = call_args["html_content"]

        # Verify filtering happened correctly (only 3 valid creatives for Germany)
        assert "ad_failed.png" not in html_content
        assert "ad_france.png" not in html_content
        assert "ad_target_cat_high.png" in html_content

        # Verify they were rendered in the correct order: target cat high, target cat low, other cat.
        idx_high = html_content.find("ad_target_cat_high.png")
        idx_low = html_content.find("ad_target_cat_low.png")
        idx_other = html_content.find("ad_other_cat.png")

        assert idx_high < idx_low < idx_other


@pytest.mark.asyncio
async def test_export_feasibility_report_flat_dict_without_status() -> None:
    # Test that a flat dictionary of brands without a "status" key extracts correctly
    feasibility_data = {
        "BMW": {
            "is_feasible": True,
            "spend": 1000,
            "impressions": 1000,
            "spend_threshold": 5000,
            "impr_threshold": 10000,
        }
    }
    with patch(
        "brand_analytics_app.tools.export_report",
        autospec=True,
        return_value={
            "status": "success",
            "html_file_uri": "gs://bucket/feasibility.html"
        }
    ) as mock_export:
        res = await export_feasibility_report(
            country="Germany",
            feasibility_data=feasibility_data,
            creative_verifications=[],
            start_date="2026-01-01",
            end_date="2026-01-31",
        )
        assert res["status"] == "success"
        mock_export.assert_called_once()
        html_content = mock_export.call_args[1]["html_content"]
        assert "BMW" in html_content
        assert "$1,000" in html_content


@pytest.mark.asyncio
async def test_export_report_supports_report_type() -> None:
    import inspect

    from brand_analytics_app.tools import export_report

    sig = inspect.signature(export_report)
    assert "report_type" in sig.parameters
    assert sig.parameters["report_type"].default == "brand"


def test_verification_prompt_platform_disambiguation() -> None:
    from pathlib import Path
    tools_file = (
        Path("brand_analytics_app/tools/creative_verification.py")
        if Path("brand_analytics_app/tools/creative_verification.py").exists()
        else Path("brand_analytics_app/tools.py")
    )
    tools_code = tools_file.read_text(encoding="utf-8")
    # Verify strict platform/podcast/third-party and matched_keywords guardrails
    assert "podcast" in tools_code.lower()
    assert "matched_keywords" in tools_code
    assert "advertiser_name" in tools_code


def test_general_export_menu_options() -> None:
    from brand_analytics_app.agent import data_analyst_agent, reporting_agent

    # 1. reporting_agent instructions must not contain Report 4
    assert "REPORT 4: Feasibility" not in reporting_agent.instruction

    # 2. data_analyst_agent instructions must not list 'feasibility' as an option for calculate_report_metrics
    analyst_instruction = data_analyst_agent.instruction
    assert "'feasibility'" not in analyst_instruction

    # 3. data_analyst_agent must instruct calling export_feasibility_report directly if user requests feasibility export
    assert "export_feasibility_report" in analyst_instruction


def test_generate_feasibility_report_html_csv_export_and_top_100() -> None:
    html = generate_feasibility_report_html(
        country="Germany",
        feasibility_data={"BMW": {"is_feasible": True, "spend": 1000, "impressions": 5000}},
        creative_verifications=[],
        start_date="2026-01-01",
        end_date="2026-01-31",
    )
    # Check for Export to CSV button
    assert "Export to CSV" in html
    assert "downloadCreativesCSV" in html
    # Check that description reflects top 100 creatives per brand
    assert "Top 100 creatives per brand verified" in html


def test_generate_feasibility_report_html_separate_brand_sections() -> None:
    creatives = [
        {
            "url": "https://example.com/telekom.png",
            "country": "Germany",
            "matched_brand": "Telekom",
            "category": "Telecommunications",
            "product": "iPhone",
            "spend": 500000,
            "impressions": 50000000,
            "explanation": "Ad for Telekom",
        },
        {
            "url": "https://example.com/spusu.png",
            "country": "Germany",
            "matched_brand": "spusu",
            "category": "Telecommunications",
            "product": "Tariff",
            "spend": 100000,
            "impressions": 20000000,
            "explanation": "Ad for spusu",
        },
    ]
    html = generate_feasibility_report_html(
        country="Germany",
        feasibility_data={
            "Telekom": {"is_feasible": True, "spend": 500000, "impressions": 50000000},
            "spusu": {"is_feasible": True, "spend": 100000, "impressions": 20000000},
        },
        creative_verifications=creatives,
        start_date="2026-01-01",
        end_date="2026-01-31",
    )
    # Check for separate brand section headings
    assert "Telekom" in html
    assert "spusu" in html
    # Check that each brand has its own table
    assert html.count('<table class="verified-creatives-table') >= 2



@pytest.mark.asyncio
async def test_export_feasibility_report_caps_at_100_per_brand() -> None:
    # Generate 120 mock creatives for Brand A and 120 for Brand B
    creatives = []
    for i in range(120):
        creatives.append({
            "url": f"https://example.com/brand_a_ad_{i}.png",
            "country": "Germany",
            "belongs_to_brand": True,
            "category": "Automotive",
            "impressions": 1000 + i,
            "matched_brand": "Brand A",
        })
    for i in range(120):
        creatives.append({
            "url": f"https://example.com/brand_b_ad_{i}.png",
            "country": "Germany",
            "belongs_to_brand": True,
            "category": "Automotive",
            "impressions": 500 + i,
            "matched_brand": "Brand B",
        })

    with patch(
        "brand_analytics_app.tools.export_report",
        autospec=True,
        return_value={"status": "success", "html_file_uri": "gs://bucket/feasibility.html"},
    ) as mock_export:
        res = await export_feasibility_report(
            country="Germany",
            feasibility_data={
                "Brand A": {"is_feasible": True, "spend": 1000, "impressions": 5000},
                "Brand B": {"is_feasible": True, "spend": 1000, "impressions": 5000},
            },
            creative_verifications=creatives,
            start_date="2026-01-01",
            end_date="2026-01-31",
        )
        assert res["status"] == "success"
        mock_export.assert_called_once()
        html_content = mock_export.call_args[1]["html_content"]

        # Brand A: 100 included (i=119 down to i=20), lowest 20 excluded
        assert "brand_a_ad_119.png" in html_content
        assert "brand_a_ad_20.png" in html_content
        assert "brand_a_ad_19.png" not in html_content
        assert "brand_a_ad_0.png" not in html_content

        # Brand B: 100 included (i=119 down to i=20), lowest 20 excluded
        assert "brand_b_ad_119.png" in html_content
        assert "brand_b_ad_20.png" in html_content
        assert "brand_b_ad_19.png" not in html_content
        assert "brand_b_ad_0.png" not in html_content


