import pytest

from brand_analytics_app.tools import execute_bq_query


@pytest.mark.asyncio
async def test_country_whitelist_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    # Set the mock integration test env variable to bypass BigQuery connection
    monkeypatch.setenv("INTEGRATION_TEST", "TRUE")

    # 1. Test supported countries (standard)
    try:
        await execute_bq_query(
            start_date="2025-01-01",
            end_date="2025-01-10",
            target_countries=["Germany"],
            include_keywords=["bmw"],
        )
    except ValueError as e:
        pytest.fail(f"Supported country Germany raised an error: {e}")

    # 2. Test supported countries (with comma - Taiwan, Province of China)
    try:
        await execute_bq_query(
            start_date="2025-01-01",
            end_date="2025-01-10",
            target_countries=["Taiwan, Province of China"],
            include_keywords=["bmw"],
        )
    except ValueError as e:
        pytest.fail(
            f"Supported country 'Taiwan, Province of China' raised an error: {e}"
        )

    # 3. Test unsupported country raises ValueError
    with pytest.raises(ValueError) as excinfo:
        await execute_bq_query(
            start_date="2025-01-01",
            end_date="2025-01-10",
            target_countries=["Morocco"],
            include_keywords=["bmw"],
        )
    assert "Unsupported country/market: 'Morocco'" in str(excinfo.value)
