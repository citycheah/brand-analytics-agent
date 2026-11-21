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
import os

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from intel_core.schemas import OverrideFieldName, OverrideTargetType
from pydantic import BaseModel, Field

from brand_analytics_app.agent_runtime_app import agent_runtime
from brand_analytics_app.tools.federated_intel import (
    apply_creative_human_override,
    get_creative_themes_and_fatigue,
    get_portal_overview,
    get_velocity_breakout_alerts_and_ops,
    inspect_creative_evidence,
    query_federated_sos_sov,
    resolve_creative_media_bytes,
    run_mmm_what_if_simulation,
)

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
    description="Backend API wrapper exposing ADK Agent SSE & Federated Intelligence Portal REST endpoints.",
    version="2.0.0",
)

_cors_raw = os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class OverrideRequest(BaseModel):
    target_key_type: OverrideTargetType = "asset_id"
    target_key_value: str
    field_name: OverrideFieldName = "matched_brand_id"
    human_value: str
    reviewer: str = "analyst"
    reason: str = ""
    ai_value: str | None = None


class MmmSimulateRequest(BaseModel):
    brand_id: str = "BMW"
    country: str = "Germany"
    total_budget_usd: float | None = Field(default=None, gt=0.0)
    proposed_spend_by_channel: dict[str, float] | None = None
    optimize: bool = False
    panel_type: str = "conversions"


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


@app.get("/api/v1/media/{asset_id}")
async def get_creative_media(asset_id: str):
    """Serves local creative binary or deterministic preview card for an `asset_id`."""
    try:
        payload, media_type = resolve_creative_media_bytes(asset_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(
        content=payload,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.post("/api/v1/overrides")
async def create_human_override(request: OverrideRequest):
    """Atomically writes a HITL creative override (`<50ms`), invalidates caches, and returns live view."""
    return apply_creative_human_override(
        target_key_type=request.target_key_type,
        target_key_value=request.target_key_value,
        field_name=request.field_name,
        human_value=request.human_value,
        reviewer=request.reviewer,
        reason=request.reason,
        ai_value=request.ai_value,
    )


@app.post("/api/v1/mmm/simulate")
async def simulate_mmm_budget(request: MmmSimulateRequest):
    """Runs pure-Python Hill diminishing-returns what-if simulation over pre-computed MMM curves."""
    result = run_mmm_what_if_simulation(
        brand_id=request.brand_id,
        country=request.country,
        total_budget_usd=request.total_budget_usd,
        proposed_spend_by_channel=request.proposed_spend_by_channel,
        optimize=request.optimize,
        panel_type=request.panel_type,
    )
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail=result.get("message", "MMM artifacts not found"))
    return result


@app.get("/api/v1/portal/overview")
async def portal_overview():
    """Returns executive KPIs across SOS/SOV, Themes, MMM, Velocity, Drift, and Audit Coverage."""
    return get_portal_overview()


@app.get("/api/v1/portal/themes")
async def portal_themes(country: str = "Germany", brand_id: str | None = None):
    """Returns SOS/SOV tables, HHI, Jaccard overlap, UMAP scatter coordinates, and fatigue flags."""
    sos_sov = query_federated_sos_sov(country=country)
    themes = get_creative_themes_and_fatigue(country=country, brand_id=brand_id)
    return {"sos_sov": sos_sov, "themes_and_fatigue": themes}


@app.get("/api/v1/portal/creatives")
async def portal_creatives(
    asset_id: str | None = None,
    brand_id: str | None = None,
    hook_type: str | None = None,
    only_overridden: bool = False,
    limit: int = 24,
):
    """Returns live DuckDB creative dissections overlaid with atomic HITL overrides."""
    return inspect_creative_evidence(
        asset_id=asset_id,
        brand_id=brand_id,
        hook_type=hook_type,
        only_overridden=only_overridden,
        limit=limit,
    )


@app.get("/api/v1/portal/mmm")
async def portal_mmm(
    brand_id: str = "BMW",
    country: str = "Germany",
    panel_type: str = "conversions",
):
    """Returns 3-tier MMM ladder diagnostics, 90% HDI ROAS intervals, Theme Attribution, and baseline curve state."""
    return run_mmm_what_if_simulation(
        brand_id=brand_id,
        country=country,
        optimize=False,
        panel_type=panel_type,
    )


@app.get("/api/v1/portal/velocity")
async def portal_velocity(top_k: int = 12, brand_id: str | None = None):
    """Returns Velocity breakout alerts, PSI drift report, FinOps ledger, and Golden Vision Eval gates."""
    return get_velocity_breakout_alerts_and_ops(top_k=top_k, brand_id=brand_id)
