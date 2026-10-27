import asyncio
import json
from collections.abc import AsyncGenerator

import httpx
import pytest

import backend.main as backend_main
from backend.main import app


@pytest.mark.asyncio
async def test_sse_heartbeat_emitted_during_slow_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies that SSE comments (: heartbeat\\n\\n) are emitted when agent_runtime is slow."""
    # Set a very short heartbeat interval for fast testing
    monkeypatch.setattr(backend_main, "SSE_HEARTBEAT_INTERVAL", 0.2)

    async def mock_slow_stream_query(*args, **kwargs) -> AsyncGenerator[dict, None]:
        yield {"type": "start", "content": "Starting analysis..."}
        # Simulate a long-running tool execution (e.g., verify_creatives_multimodal)
        await asyncio.sleep(0.6)
        yield {"type": "end", "content": "Analysis complete."}

    monkeypatch.setattr(
        backend_main.agent_runtime, "async_stream_query", mock_slow_stream_query
    )

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        chunks = []
        async with client.stream(
            "POST",
            "/query/stream",
            json={"message": "Analyze creatives", "session_id": "test-session"},
        ) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers.get("content-type", "")
            async for line in response.aiter_lines():
                if line:
                    chunks.append(line)

    # Verify heartbeats were emitted
    heartbeats = [c for c in chunks if c.strip() == ": heartbeat"]
    assert len(heartbeats) >= 2, (
        f"Expected at least 2 heartbeats, got {len(heartbeats)}: {chunks}"
    )

    # Verify real data events were also yielded
    data_events = [c for c in chunks if c.startswith("data: ")]
    assert len(data_events) == 2
    event_1 = json.loads(data_events[0].replace("data: ", ""))
    event_2 = json.loads(data_events[1].replace("data: ", ""))
    assert event_1["type"] == "start"
    assert event_2["type"] == "end"


@pytest.mark.asyncio
async def test_sse_fast_query_no_heartbeat_needed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies that normal fast queries stream events without delay or unnecessary heartbeats."""
    monkeypatch.setattr(backend_main, "SSE_HEARTBEAT_INTERVAL", 2.0)

    async def mock_fast_stream_query(*args, **kwargs) -> AsyncGenerator[dict, None]:
        yield {"type": "chunk", "content": "Part 1"}
        yield {"type": "chunk", "content": "Part 2"}

    monkeypatch.setattr(
        backend_main.agent_runtime, "async_stream_query", mock_fast_stream_query
    )

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        chunks = []
        async with client.stream(
            "POST",
            "/query/stream",
            json={"message": "Fast query", "session_id": "fast-session"},
        ) as response:
            assert response.status_code == 200
            async for line in response.aiter_lines():
                if line:
                    chunks.append(line)

    heartbeats = [c for c in chunks if c.strip() == ": heartbeat"]
    assert len(heartbeats) == 0

    data_events = [c for c in chunks if c.startswith("data: ")]
    assert len(data_events) == 2


@pytest.mark.asyncio
async def test_sse_error_propagation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifies that exceptions during agent execution are yielded as an INTERNAL_ERROR SSE payload."""
    monkeypatch.setattr(backend_main, "SSE_HEARTBEAT_INTERVAL", 1.0)

    async def mock_error_stream_query(*args, **kwargs) -> AsyncGenerator[dict, None]:
        yield {"type": "init"}
        raise RuntimeError("Simulated ADK error")

    monkeypatch.setattr(
        backend_main.agent_runtime, "async_stream_query", mock_error_stream_query
    )

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        chunks = []
        async with client.stream(
            "POST",
            "/query/stream",
            json={"message": "Error query", "session_id": "err-session"},
        ) as response:
            assert response.status_code == 200
            async for line in response.aiter_lines():
                if line:
                    chunks.append(line)

    data_events = [c for c in chunks if c.startswith("data: ")]
    assert len(data_events) == 2
    err_event = json.loads(data_events[1].replace("data: ", ""))
    assert err_event.get("error_code") == "INTERNAL_ERROR"
    assert "Simulated ADK error" in err_event.get("error_message", "")
