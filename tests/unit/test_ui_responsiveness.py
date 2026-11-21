"""Tests for retired Chainlit UI stub, FastAPI SSE concurrency lock (409), and Portal responsiveness."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator

import httpx
import pytest

import backend.main as backend_main
from backend.main import app


def test_legacy_chainlit_frontend_is_retired_with_deprecation() -> None:
    import frontend.app as legacy_ui

    with pytest.warns(DeprecationWarning, match="retired"), pytest.raises(RuntimeError, match="retired"):
        legacy_ui.main()


@pytest.mark.asyncio
async def test_backend_sse_rejects_concurrent_session_with_409(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies FastAPI /query/stream enforces single-flight session concurrency (HTTP 409)."""
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_stream(*args, **kwargs) -> AsyncGenerator[dict, None]:
        started.set()
        yield {"type": "start", "content": "Processing..."}
        await release.wait()
        yield {"type": "end", "content": "Done."}

    monkeypatch.setattr(backend_main.agent_runtime, "async_stream_query", slow_stream)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        async def consume_first() -> list[str]:
            lines: list[str] = []
            async with client.stream(
                "POST",
                "/query/stream",
                json={"message": "Analyze BMW DE", "session_id": "concurrent-sess"},
            ) as resp:
                assert resp.status_code == 200
                async for line in resp.aiter_lines():
                    if line:
                        lines.append(line)
            return lines

        first_task = asyncio.create_task(consume_first())
        await asyncio.wait_for(started.wait(), timeout=2.0)

        conflict = await client.post(
            "/query/stream",
            json={"message": "Second request while busy", "session_id": "concurrent-sess"},
        )
        assert conflict.status_code == 409
        assert "busy" in conflict.json()["detail"].lower()

        release.set()
        lines = await asyncio.wait_for(first_task, timeout=2.0)
        assert any("Done." in ln for ln in lines)
