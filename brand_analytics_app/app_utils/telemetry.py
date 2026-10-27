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
import logging
import os
from typing import Any

try:
    from google.adk.agents.callback_context import CallbackContext
    from google.adk.models import LlmRequest, LlmResponse
    from google.adk.tools.base_tool import BaseTool
    from google.adk.tools.tool_context import ToolContext
except ImportError:
    CallbackContext = Any  # type: ignore[misc,assignment]
    LlmRequest = Any  # type: ignore[misc,assignment]
    LlmResponse = Any  # type: ignore[misc,assignment]
    BaseTool = Any  # type: ignore[misc,assignment]
    ToolContext = Any  # type: ignore[misc,assignment]


def setup_telemetry() -> str | None:
    """Configure OpenTelemetry and GenAI telemetry with GCS upload."""
    os.environ.setdefault("GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY", "true")

    bucket = os.environ.get("LOGS_BUCKET_NAME")
    capture_content = os.environ.get(
        "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "NO_CONTENT"
    )
    if bucket and str(capture_content).lower() != "false":
        logging.info(
            "Prompt-response logging enabled - mode: NO_CONTENT (metadata only, no prompts/responses)"
        )
        os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] = "NO_CONTENT"
        os.environ.setdefault("OTEL_INSTRUMENTATION_GENAI_UPLOAD_FORMAT", "jsonl")
        os.environ.setdefault("OTEL_INSTRUMENTATION_GENAI_COMPLETION_HOOK", "upload")
        os.environ.setdefault(
            "OTEL_SEMCONV_STABILITY_OPT_IN", "gen_ai_latest_experimental"
        )
        commit_sha = os.environ.get("COMMIT_SHA", "dev")
        os.environ.setdefault(
            "OTEL_RESOURCE_ATTRIBUTES",
            f"service.namespace=brand-analytics-agent,service.version={commit_sha}",
        )
        path = os.environ.get("GENAI_TELEMETRY_PATH", "completions")
        os.environ.setdefault(
            "OTEL_INSTRUMENTATION_GENAI_UPLOAD_BASE_PATH",
            f"gs://{bucket}/{path}",
        )
    else:
        logging.info(
            "Prompt-response logging disabled (set LOGS_BUCKET_NAME=your-bucket-name and OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=NO_CONTENT to enable)"
        )

    return bucket


def before_model_log(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> None:
    session_id = getattr(
        getattr(callback_context, "session", None), "id", "UnknownSession"
    )
    agent = getattr(callback_context, "agent_name", "UnknownAgent")
    node = getattr(callback_context, "node_path", "UnknownNode")
    logging.info(f"[Session: {session_id}] [Model Start] Agent: {agent} | Node: {node}")


def after_model_log(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> None:
    session_id = getattr(
        getattr(callback_context, "session", None), "id", "UnknownSession"
    )
    agent = getattr(callback_context, "agent_name", "UnknownAgent")

    # 1. Log token telemetry if usage_metadata is present
    if llm_response.usage_metadata:
        tokens = llm_response.usage_metadata
        p_tok = getattr(tokens, "prompt_token_count", 0)
        c_tok = getattr(tokens, "candidates_token_count", 0)
        t_tok = getattr(tokens, "total_token_count", 0)
        logging.info(
            f"[Session: {session_id}] [Model End] Agent: {agent} | Tokens: Prompt {p_tok}, Candidate {c_tok}, Total {t_tok}"
        )
    else:
        logging.info(
            f"[Session: {session_id}] [Model End] Agent: {agent} | No token usage metadata available"
        )

    # 2. Log triggered tool actions (function calls)
    if llm_response.content and llm_response.content.parts:
        for part in llm_response.content.parts:
            if part.function_call:
                logging.info(
                    f"[Session: {session_id}] [Action] Agent: {agent} triggered tool '{part.function_call.name}'"
                )


def before_tool_log(
    tool: BaseTool, args: dict[str, Any], tool_context: ToolContext
) -> None:
    session_id = getattr(getattr(tool_context, "session", None), "id", "UnknownSession")
    tool_name = getattr(tool, "name", "UnknownTool")
    arg_keys = list(args.keys()) if isinstance(args, dict) else []
    logging.info(
        f"[Session: {session_id}] [Tool Start] Tool: {tool_name} | Argument keys: {arg_keys}"
    )

    # Custom tracking to verify if DataAnalystAgent passes target_category when it shouldn't
    if tool_name == "verify_creatives_multimodal":
        target_cat = args.get("target_category")
        if target_cat is not None:
            logging.info(
                f"[Session: {session_id}] [TRACKING] verify_creatives_multimodal called with target_category={target_cat!r}."
            )
            if isinstance(target_cat, str) and target_cat.strip():
                logging.warning(
                    f"[Session: {session_id}] [TRACKING-WARNING] verify_creatives_multimodal received active target_category: '{target_cat}'. "
                    f"Ensure this was explicitly requested by the user, otherwise it will disable domain filtering!"
                )
        else:
            logging.info(
                f"[Session: {session_id}] [TRACKING] verify_creatives_multimodal called WITHOUT target_category (domain filtering active)."
            )


def after_tool_log(
    tool: BaseTool, args: dict[str, Any], tool_context: ToolContext, tool_response: dict
) -> None:
    session_id = getattr(getattr(tool_context, "session", None), "id", "UnknownSession")
    tool_name = getattr(tool, "name", "UnknownTool")
    logging.info(
        f"[Session: {session_id}] [Tool End] Tool: {tool_name} | Success: True"
    )
