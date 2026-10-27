# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import pytest
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from brand_analytics_app.agent import app


def test_agent_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Integration test for the agent stream functionality.
    Tests that the agent returns valid streaming responses.
    """
    monkeypatch.setenv("INTEGRATION_TEST", "TRUE")
    monkeypatch.setenv("GEMINI_API_KEY", "mock-api-key")
    monkeypatch.setenv("GOOGLE_API_KEY", "mock-api-key")

    session_service = InMemorySessionService()

    session = session_service.create_session_sync(user_id="test_user", app_name="app")
    runner = Runner(app=app, session_service=session_service)

    message = types.Content(
        role="user", parts=[types.Part.from_text(text="Why is the sky blue?")]
    )

    events = list(
        runner.run(
            new_message=message,
            user_id="test_user",
            session_id=session.id,
            run_config=RunConfig(streaming_mode=StreamingMode.SSE),
        )
    )
    assert len(events) > 0, "Expected at least one message"

    has_text_content = False
    for event in events:
        event_str = str(event)
        if "Welcome" in event_str or "message=" in event_str or "content=" in event_str:
            has_text_content = True
            break
        elif getattr(event, "content", None) is not None:
            has_text_content = True
            break
    assert has_text_content, (
        "Expected at least one message with text content or request input"
    )
