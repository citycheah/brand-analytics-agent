"""Tests for safe JSON ADK session persistence (no pickle) and atomic HITL overrides."""

from __future__ import annotations

from pathlib import Path

import pytest
from intel_core.storage import HumanOverrideStore

from brand_analytics_app.agent_runtime_app import GcsSessionService


@pytest.mark.asyncio
async def test_json_session_persistence_roundtrip_without_pickle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATA_BACKEND", "local")
    service = GcsSessionService()

    created = await service.create_session(
        app_name="brand_analytics",
        user_id="exec_user",
        state={"market": "Germany"},
        session_id="json-sess-01",
    )
    assert created.id == "json-sess-01"

    saved_json = tmp_path / ".sessions" / "json-sess-01.json"
    assert saved_json.exists()
    assert not (tmp_path / ".sessions" / "json-sess-01.pkl").exists()

    # Re-instantiate fresh service to confirm reload from JSON on disk
    reloaded_service = GcsSessionService()
    loaded = await reloaded_service.get_session(
        app_name="brand_analytics",
        user_id="exec_user",
        session_id="json-sess-01",
    )
    assert loaded is not None
    assert loaded.state["market"] == "Germany"

    await reloaded_service.delete_session(
        app_name="brand_analytics",
        user_id="exec_user",
        session_id="json-sess-01",
    )
    assert not saved_json.exists()


def test_human_override_store_atomic_persistence(tmp_path: Path) -> None:
    store = HumanOverrideStore(tmp_path / "overrides")
    store.write_override(
        target_key_type="asset_id",
        target_key_value="asset_abc",
        field_name="matched_brand_id",
        human_value="BMW",
        reviewer="qa_analyst",
        reason="Visible grille badge",
    )
    df = store.to_dataframe()
    assert len(df) == 1
    assert df.iloc[0]["human_value"] == "BMW"
