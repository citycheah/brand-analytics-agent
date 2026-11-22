"""ADK tool-trajectory evaluation tests (google-adk[eval] + federated lakehouse tools)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest

from brand_analytics_app.agent import data_analyst_agent

CASES_PATH = Path(__file__).resolve().parent / "datasets" / "federated_intel_cases.json"
_REPO_LAKEHOUSE = Path(__file__).resolve().parents[2] / "data" / "eu_auto_lakehouse"
_PARENT_LAKEHOUSE = Path(__file__).resolve().parents[3] / "data" / "eu_auto_lakehouse"
WORKSPACE_LAKEHOUSE = _REPO_LAKEHOUSE if _REPO_LAKEHOUSE.exists() else _PARENT_LAKEHOUSE


def test_adk_agent_registers_all_federated_tools_without_heavy_ml_imports() -> None:
    tool_names = {
        getattr(t, "__name__", getattr(t, "name", str(t)))
        for t in (getattr(data_analyst_agent, "tools", []) or [])
    }
    expected = {
        "query_federated_sos_sov",
        "get_creative_themes_and_fatigue",
        "inspect_creative_evidence",
        "run_mmm_what_if_simulation",
        "get_velocity_breakout_alerts_and_ops",
    }
    assert expected.issubset(tool_names)

    # Architecture guardrail: brand-analytics-agent must NEVER require heavy ML/browser engines
    import sys
    for forbidden_mod in ("pymc", "torch", "pyspark", "playwright", "dbt"):
        assert forbidden_mod not in sys.modules, f"Heavy runtime {forbidden_mod} leaked into agent runtime"


def test_adk_eval_package_and_trajectory_cases(monkeypatch: pytest.MonkeyPatch) -> None:
    # Verify google.adk.evaluation is installed when google-adk[eval] is synced
    spec = importlib.util.find_spec("google.adk.evaluation")
    assert spec is not None, "google-adk[eval] evaluation package is not installed"

    if WORKSPACE_LAKEHOUSE.exists():
        monkeypatch.setenv("INTEL_LAKEHOUSE_DIR", str(WORKSPACE_LAKEHOUSE))

    cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))["eval_cases"]
    tool_map: dict[str, Any] = {
        getattr(t, "__name__", getattr(t, "name", "")): t
        for t in (getattr(data_analyst_agent, "tools", []) or [])
        if callable(t)
    }

    for case in cases:
        for tool_name in case["expected_tool_calls"]:
            assert tool_name in tool_map, f"Missing ADK tool {tool_name} for {case['eval_case_id']}"
            if WORKSPACE_LAKEHOUSE.exists():
                result = tool_map[tool_name](**case["expected_args"])
                assert isinstance(result, dict)
                assert result.get("status") in ("success", "empty")
