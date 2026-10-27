import json
from unittest.mock import MagicMock

import httpx
import pytest

import frontend.app as frontend_app


class MockUserSession:
    def __init__(self, initial_data=None):
        self._data = initial_data or {}

    def get(self, key, default=None):
        return self._data.get(key, default)

    def set(self, key, value):
        self._data[key] = value


@pytest.fixture
def mock_cl_context(monkeypatch):
    """Sets up mocks for chainlit user_session, context, and message/step classes."""
    session_store = MockUserSession()
    monkeypatch.setattr(frontend_app.cl, "user_session", session_store)

    mock_context = MagicMock()
    mock_context.session.thread_id = "test-thread"
    mock_context.session.user = MagicMock(identifier="test-user")
    monkeypatch.setattr(frontend_app.cl, "context", mock_context)

    return session_store


@pytest.mark.asyncio
async def test_on_chat_start_initializes_processing_flag(mock_cl_context, monkeypatch):
    """Verifies that on_chat_start initializes _processing to False."""
    monkeypatch.setattr(frontend_app.cl_data, "_data_layer", None)
    await frontend_app.on_chat_start()
    assert mock_cl_context.get("_processing") is False
    assert mock_cl_context.get("session_id") is not None


@pytest.mark.asyncio
async def test_on_chat_resume_resets_processing_flag(mock_cl_context):
    """Verifies that on_chat_resume resets _processing to False even if previously True."""
    mock_cl_context.set("_processing", True)
    await frontend_app.on_chat_resume(
        {"metadata": json.dumps({"session_id": "resumed-session"})}
    )
    assert mock_cl_context.get("_processing") is False
    assert mock_cl_context.get("session_id") == "resumed-session"


@pytest.mark.asyncio
async def test_on_message_blocks_concurrent_execution(mock_cl_context, monkeypatch):
    """Verifies that if _processing is True, a new message is rejected immediately."""
    mock_cl_context.set("_processing", True)
    mock_cl_context.set("session_id", "test-session")

    sent_messages = []

    class MockMessage:
        def __init__(self, content="", author="", **kwargs):
            self.content = content
            self.author = author

        async def send(self):
            sent_messages.append(self)

    monkeypatch.setattr(frontend_app.cl, "Message", MockMessage)

    # We patch aconnect_sse to make sure it is NEVER called
    mock_sse = MagicMock()
    monkeypatch.setattr(frontend_app, "aconnect_sse", mock_sse)

    msg = MockMessage(content="Another prompt while running")
    await frontend_app.on_message(msg)

    # Must send the warning message
    assert len(sent_messages) == 1
    assert "still processing your previous request" in sent_messages[0].content
    # Must NOT call the backend
    mock_sse.assert_not_called()
    # _processing remains True for the ongoing task
    assert mock_cl_context.get("_processing") is True


@pytest.mark.asyncio
async def test_on_message_thinking_step_lifecycle(mock_cl_context, monkeypatch):
    """Verifies that on_message creates a thinking step, updates it during tool calls, and resets _processing."""
    mock_cl_context.set("_processing", False)
    mock_cl_context.set("session_id", "test-session")

    created_steps = []
    step_name_history = []

    class MockStep:
        def __init__(self, name="", type="tool", **kwargs):
            self.name = name
            self.type = type
            self.input = None
            self.output = None
            created_steps.append(self)

        async def send(self):
            step_name_history.append((self.type, self.name, "send"))

        async def update(self):
            step_name_history.append((self.type, self.name, "update"))

    class MockMessage:
        def __init__(self, content="", author="", **kwargs):
            self.content = content
            self.author = author
            self.elements = []

        async def stream_token(self, token):
            self.content += token

        async def send(self):
            pass

    monkeypatch.setattr(frontend_app.cl, "Step", MockStep)
    monkeypatch.setattr(frontend_app.cl, "Message", MockMessage)

    # Mock SSE events: tool start -> tool end -> response text
    class FakeSSEEvent:
        def __init__(self, data):
            self.data = json.dumps(data)

    class FakeEventSource:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def aiter_sse(self):
            # 1. tool call starts
            yield FakeSSEEvent(
                {
                    "content": {
                        "parts": [
                            {
                                "function_call": {
                                    "name": "verify_creatives_multimodal",
                                    "args": {"country": "Germany"},
                                }
                            }
                        ]
                    }
                }
            )
            # 2. tool call ends
            yield FakeSSEEvent(
                {
                    "content": {
                        "parts": [
                            {
                                "function_response": {
                                    "name": "verify_creatives_multimodal",
                                    "response": {"status": "verified"},
                                }
                            }
                        ]
                    }
                }
            )
            # 3. assistant text response
            yield FakeSSEEvent(
                {"content": {"parts": [{"text": "Verification completed."}]}}
            )

    monkeypatch.setattr(
        frontend_app,
        "aconnect_sse",
        lambda *args, **kwargs: FakeEventSource(),
    )

    msg = MockMessage(content="Verify creatives")
    await frontend_app.on_message(msg)

    # 1. Redundant thinking step of type 'run' must NOT be created
    run_steps = [s for s in created_steps if s.type == "run"]
    assert len(run_steps) == 0

    # 2. Tool steps of type 'tool' must be tracked and completed
    tool_steps = [s for s in created_steps if s.type == "tool"]
    assert len(tool_steps) == 1
    assert "Multimodal Creative Verification" in tool_steps[0].name
    assert "```json" in tool_steps[0].output

    # 3. _processing flag must be reset to False
    assert mock_cl_context.get("_processing") is False


@pytest.mark.asyncio
async def test_on_message_handles_409_conflict(mock_cl_context, monkeypatch):
    """Verifies that HTTP 409 Conflict from the backend is handled gracefully with a friendly user message."""
    mock_cl_context.set("_processing", False)
    mock_cl_context.set("session_id", "test-session")

    sent_messages = []

    class MockMessage:
        def __init__(self, content="", author="", **kwargs):
            self.content = content
            self.author = author

        async def send(self):
            sent_messages.append(self)

    monkeypatch.setattr(frontend_app.cl, "Message", MockMessage)

    class Fake409ErrorSource:
        async def __aenter__(self):
            request = httpx.Request("POST", "http://backend/query/stream")
            response = httpx.Response(status_code=409, request=request)
            raise httpx.HTTPStatusError(
                "409 Conflict", request=request, response=response
            )

        async def __aexit__(self, *args):
            pass

    monkeypatch.setattr(
        frontend_app,
        "aconnect_sse",
        lambda *args, **kwargs: Fake409ErrorSource(),
    )

    msg = MockMessage(content="Another query while busy")
    await frontend_app.on_message(msg)

    # Must send a friendly wait message, not raise or crash
    assert any("still processing" in m.content for m in sent_messages)
    assert mock_cl_context.get("_processing") is False


@pytest.mark.asyncio
async def test_on_message_handles_sse_content_type_409(mock_cl_context, monkeypatch):
    """Verifies that when aconnect_sse yields a 409 response with application/json (as on browser refresh),
    the frontend cleanly shows a background processing notice rather than a Content-Type error."""
    mock_cl_context.set("_processing", False)
    mock_cl_context.set("session_id", "test-session")

    sent_messages = []
    sent_errors = []

    class MockMessage:
        def __init__(self, content="", author="", **kwargs):
            self.content = content
            self.author = author

        async def send(self):
            sent_messages.append(self)

    class MockErrorMessage:
        def __init__(self, content="", **kwargs):
            self.content = content

        async def send(self):
            sent_errors.append(self)

    monkeypatch.setattr(frontend_app.cl, "Message", MockMessage)
    monkeypatch.setattr(frontend_app.cl, "ErrorMessage", MockErrorMessage)

    class Fake409EventSource:
        def __init__(self):
            self.response = MagicMock(status_code=409, is_error=True)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def aiter_sse(self):
            # In httpx_sse, aiter_sse raises SSEError if content-type was application/json
            from httpx_sse import SSEError

            raise SSEError(
                "Expected response header Content-Type to contain 'text/event-stream', got 'application/json'"
            )
            yield None

    monkeypatch.setattr(
        frontend_app,
        "aconnect_sse",
        lambda *args, **kwargs: Fake409EventSource(),
    )

    msg = MockMessage(content="Retrying after browser refresh")
    await frontend_app.on_message(msg)

    # Must send the friendly background processing message
    assert len(sent_messages) == 1
    assert (
        "still processing your previous request in the background"
        in sent_messages[0].content
    )
    assert len(sent_errors) == 0
    assert mock_cl_context.get("_processing") is False


@pytest.mark.asyncio
async def test_on_message_exception_resets_processing_flag(
    mock_cl_context, monkeypatch
):
    """Verifies that an unhandled exception inside on_message resets _processing to False."""
    mock_cl_context.set("_processing", False)
    mock_cl_context.set("session_id", "test-session")

    class MockStep:
        def __init__(self, *args, **kwargs):
            self.type = kwargs.get("type", "run")
            self.name = kwargs.get("name", "")
            self.output = None

        async def send(self):
            pass

        async def update(self):
            pass

    class MockMessage:
        def __init__(self, *args, **kwargs):
            self.content = kwargs.get("content", "")

        async def stream_token(self, token):
            pass

        async def send(self):
            pass

    class MockErrorMessage:
        def __init__(self, content="", **kwargs):
            self.content = content

        async def send(self):
            pass

    monkeypatch.setattr(frontend_app.cl, "Step", MockStep)
    monkeypatch.setattr(frontend_app.cl, "Message", MockMessage)
    monkeypatch.setattr(frontend_app.cl, "ErrorMessage", MockErrorMessage)

    class FailingEventSource:
        async def __aenter__(self):
            raise ConnectionError("Backend connection dropped")

        async def __aexit__(self, *args):
            pass

    monkeypatch.setattr(
        frontend_app,
        "aconnect_sse",
        lambda *args, **kwargs: FailingEventSource(),
    )

    msg = MockMessage(content="Trigger error")
    await frontend_app.on_message(msg)

    # Flag must be reset in finally block despite exception
    assert mock_cl_context.get("_processing") is False
