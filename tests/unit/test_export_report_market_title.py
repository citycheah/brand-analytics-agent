from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from brand_analytics_app.agent import reporting_agent
from brand_analytics_app.tools import export_report


@pytest.mark.asyncio
async def test_export_report_adds_market_to_title_and_h1_when_missing():
    html_input = """<!DOCTYPE html>
<html>
<head>
<title>Trends, Share of Spend (SOS) & Share of Voice (SOV) Report</title>
</head>
<body>
<h1>Trends, Share of Spend (SOS) & Share of Voice (SOV) Report</h1>
<p>Some content</p>
</body>
</html>"""

    with patch("brand_analytics_app.tools.configs.LOCAL_DEV_WRITE", False):
        await export_report(
            html_content=html_input,
            country="Germany",
            start_date="2026-01-01",
            end_date="2026-03-31",
            tool_context=None,
        )

    # We need to inspect the modified html_content.
    # To check what was exported, we can mock ToolContext or inspect the return value / file writing.
    # Let's test with a mock tool_context that captures save_artifact.
    mock_context = MagicMock()
    mock_context.save_artifact = AsyncMock(return_value=1)

    await export_report(
        html_content=html_input,
        country="Germany",
        start_date="2026-01-01",
        end_date="2026-03-31",
        tool_context=mock_context,
    )

    call_args = mock_context.save_artifact.call_args
    assert call_args is not None
    saved_blob = call_args[0][1]
    saved_html = saved_blob.inline_data.data.decode("utf-8")

    assert "<title>Trends, Share of Spend (SOS) & Share of Voice (SOV) Report — Germany</title>" in saved_html
    assert "<h1>Trends, Share of Spend (SOS) & Share of Voice (SOV) Report — Germany</h1>" in saved_html


@pytest.mark.asyncio
async def test_export_report_preserves_existing_market_in_title_and_h1():
    html_input = """<!DOCTYPE html>
<html>
<head>
<title>Channel Group Summary Report — Germany</title>
</head>
<body>
<h1 class="main-title">Channel Group Summary Report — Germany</h1>
<p>Some content</p>
</body>
</html>"""

    mock_context = MagicMock()
    mock_context.save_artifact = AsyncMock(return_value=1)

    await export_report(
        html_content=html_input,
        country="Germany",
        start_date="2026-01-01",
        end_date="2026-03-31",
        tool_context=mock_context,
    )

    call_args = mock_context.save_artifact.call_args
    saved_blob = call_args[0][1]
    saved_html = saved_blob.inline_data.data.decode("utf-8")

    # Should not duplicate Germany (e.g. "Germany — Germany")
    assert "Germany — Germany" not in saved_html
    assert "<title>Channel Group Summary Report — Germany</title>" in saved_html
    assert '<h1 class="main-title">Channel Group Summary Report — Germany</h1>' in saved_html


def test_reporting_agent_instruction_contains_market_title_rule():
    instruction = reporting_agent.instruction
    assert "market" in instruction.lower() or "country" in instruction.lower()
    assert "title" in instruction.lower()
    assert "<h1>" in instruction.lower()
