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
import asyncio
import json
import logging

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from brand_analytics_app.agent_runtime_app import agent_runtime

# Initialize Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("backend_api")

SSE_HEARTBEAT_INTERVAL = 15  # seconds between heartbeat comments when idle

# Set up the Agent Runtime (initializes Model Client & Services)
try:
    agent_runtime.set_up()
    # Enable automatic session creation in the ADK runner
    runner = agent_runtime._tmpl_attrs.get("runner")
    if runner:
        runner.auto_create_session = True
        logger.info("[+] Enabled auto_create_session in ADK runner.")
    logger.info("[+] Successfully set up ADK Agent Engine runtime.")
except Exception as e:
    logger.error(f"[-] Failed to set up ADK Agent Engine runtime: {e}")

app = FastAPI(
    title="Brand Analytics Agent API",
    description="Backend API wrapper exposing ADK Agent as a streaming REST service.",
    version="1.0.0",
)


class StreamQueryRequest(BaseModel):
    message: str = Field(..., description="The query string to send to the agent.")
    user_id: str = Field("production-user", description="Identifies the calling user.")
    session_id: str | None = Field(
        None, description="Optional conversation session ID to persist history."
    )


active_sessions: set[str] = set()


@app.post("/query/stream")
async def query_stream(request: StreamQueryRequest):
    """Streams responses from the agent back to the client using Server-Sent Events (SSE)."""
    if request.session_id:
        if request.session_id in active_sessions:
            logger.warning(
                f"[!] Rejected concurrent query for active session_id: {request.session_id}"
            )
            from fastapi.responses import JSONResponse

            return JSONResponse(
                status_code=409,
                content={
                    "detail": "Session is currently busy processing a previous request."
                },
            )
        active_sessions.add(request.session_id)

    logger.info(
        f"[*] Stream query received: {request.message[:50]}... | session_id: {request.session_id}"
    )

    async def sse_event_generator():
        heartbeat_interval = SSE_HEARTBEAT_INTERVAL
        queue = asyncio.Queue()

        async def consume_events():
            try:
                async for event in agent_runtime.async_stream_query(
                    message=request.message,
                    user_id=request.user_id,
                    session_id=request.session_id,
                ):
                    await queue.put(("event", event))
            except Exception as e:
                logger.error(f"[-] Error during agent execution: {e}", exc_info=True)
                await queue.put(("error", e))
            finally:
                if request.session_id:
                    active_sessions.discard(request.session_id)
                await queue.put(("done", None))

        task = asyncio.create_task(consume_events())

        try:
            while True:
                try:
                    msg_type, payload = await asyncio.wait_for(
                        queue.get(), timeout=heartbeat_interval
                    )
                    if msg_type == "done":
                        break
                    elif msg_type == "error":
                        err_payload = {
                            "error_code": "INTERNAL_ERROR",
                            "error_message": str(payload),
                        }
                        yield f"data: {json.dumps(err_payload)}\n\n"
                        break
                    else:
                        yield f"data: {json.dumps(payload)}\n\n"
                except TimeoutError:
                    # SSE comment keeps the connection alive without affecting the client
                    yield ": heartbeat\n\n"
        finally:
            task.cancel()

    return StreamingResponse(sse_event_generator(), media_type="text/event-stream")


@app.get("/healthz")
async def health_check():
    """Liveness/readiness probe endpoint."""
    return {"status": "ok"}
