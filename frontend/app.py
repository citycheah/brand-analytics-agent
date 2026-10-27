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
import datetime
import functools
import json
import os
import signal
import sqlite3
import uuid
from typing import Any

import chainlit as cl
import chainlit.data as cl_data
import httpx
from bs4 import BeautifulSoup
from chainlit.data.sql_alchemy import SQLAlchemyDataLayer
from google.cloud import storage
from httpx_sse import aconnect_sse
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DatabaseError, OperationalError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker


@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Configures SQLite to use memory journals and temp stores, avoiding GCS FUSE write issues."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=MEMORY")
    cursor.execute("PRAGMA temp_store=MEMORY")
    cursor.close()


# Load Configs
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8080")
LOCAL_DB_PATH = os.environ.get("LOCAL_DB_PATH", "/tmp/data.db")
GCS_BUCKET_NAME = os.environ.get(
    "LOGS_BUCKET_NAME", "brand-analytics-agent-logs"
)
GCS_DB_BLOB_NAME = os.environ.get("GCS_DB_BLOB_NAME", "data.db")
DATABASE_URL = f"sqlite+aiosqlite:///{LOCAL_DB_PATH}"
ALLOWED_DOMAINS = [
    d.strip()
    for d in os.environ.get("ALLOWED_DOMAINS", "example.com").split(",")
    if d.strip()
]

TOOL_ALIASES = {
    "BrandIdentityFinderAgent": "Web Searching for Keywords Discovery",
    "execute_bq_query": "Database Query",
    "calculate_brand_metrics": "SOS & SOV Metrics",
    "check_brand_feasibility": "Brand Feasibility Evaluation",
    "get_feasibility_thresholds": "Brand Feasibility Thresholds Retrieval",
    "verify_creatives_multimodal": "Multimodal Creative Verification",
    "export_report": "Analytics Report Generation",
    "sandboxed_python_interpreter": "Custom Python Analysis",
    "google_search": "Web Search Grounding",
    "calculate_report_metrics": "Report Metrics Calculation",
}


def init_db():
    """Ensure the SQLite database directory and tables exist before startup, restoring from GCS if needed."""
    db_uri = DATABASE_URL
    if db_uri.startswith("sqlite+aiosqlite:///"):
        db_path = db_uri.replace("sqlite+aiosqlite:///", "")
    elif db_uri.startswith("sqlite:///"):
        db_path = db_uri.replace("sqlite:///", "")
    else:
        return

    # Ensure parent directory exists
    db_dir = os.path.dirname(os.path.abspath(db_path))
    os.makedirs(db_dir, exist_ok=True)

    # If the local database doesn't exist yet, attempt to restore from GCS (bypassing FUSE in Cloud Run)
    if not os.path.exists(db_path) and (
        os.environ.get("K_SERVICE") or os.environ.get("ENABLE_GCS_SYNC")
    ):
        try:
            client = storage.Client()
            bucket = client.bucket(GCS_BUCKET_NAME)
            blob = bucket.blob(GCS_DB_BLOB_NAME)
            if blob.exists():
                print(
                    f"[+] Restoring database snapshot from gs://{GCS_BUCKET_NAME}/{GCS_DB_BLOB_NAME} to {db_path}..."
                )
                blob.download_to_filename(db_path)
                print("[+] Database restored successfully from GCS.")
            else:
                print(
                    f"[*] No existing database snapshot found at gs://{GCS_BUCKET_NAME}/{GCS_DB_BLOB_NAME}. Starting with fresh DB."
                )
        except Exception as e:
            print(
                f"[-] Could not restore database from GCS (proceeding with fresh local DB): {e}"
            )

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("PRAGMA journal_mode=MEMORY")
    cursor.execute("PRAGMA temp_store=MEMORY")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        "id" TEXT PRIMARY KEY,
        "identifier" TEXT NOT NULL UNIQUE,
        "metadata" TEXT NOT NULL,
        "createdAt" TEXT
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS threads (
        "id" TEXT PRIMARY KEY,
        "createdAt" TEXT,
        "name" TEXT,
        "userId" TEXT,
        "userIdentifier" TEXT,
        "tags" TEXT,
        "metadata" TEXT,
        FOREIGN KEY ("userId") REFERENCES users("id") ON DELETE CASCADE
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS steps (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "threadId" TEXT NOT NULL,
        "parentId" TEXT,
        "streaming" BOOLEAN NOT NULL,
        "waitForAnswer" BOOLEAN,
        "isError" BOOLEAN,
        "metadata" TEXT,
        "tags" TEXT,
        "input" TEXT,
        "output" TEXT,
        "createdAt" TEXT,
        "start" TEXT,
        "end" TEXT,
        "generation" TEXT,
        "showInput" TEXT,
        "language" TEXT,
        "defaultOpen" BOOLEAN,
        "autoCollapse" BOOLEAN,
        FOREIGN KEY ("threadId") REFERENCES threads("id") ON DELETE CASCADE
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS elements (
        "id" TEXT PRIMARY KEY,
        "threadId" TEXT,
        "type" TEXT,
        "url" TEXT,
        "chainlitKey" TEXT,
        "name" TEXT NOT NULL,
        "display" TEXT,
        "objectKey" TEXT,
        "size" TEXT,
        "page" INT,
        "language" TEXT,
        "forId" TEXT,
        "mime" TEXT,
        "props" TEXT,
        FOREIGN KEY ("threadId") REFERENCES threads("id") ON DELETE CASCADE
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS feedbacks (
        "id" TEXT PRIMARY KEY,
        "forId" TEXT NOT NULL,
        "value" INT NOT NULL,
        "comment" TEXT,
        FOREIGN KEY ("forId") REFERENCES steps("id") ON DELETE CASCADE
    );
    """)

    conn.commit()
    conn.close()


def sync_db_to_storage():
    """Takes a non-blocking point-in-time snapshot using sqlite3.backup() and uploads to GCS."""
    # Safety guard: Never sync to production GCS in local development
    if not os.environ.get("K_SERVICE") and not os.environ.get("ENABLE_GCS_SYNC"):
        return

    if not os.path.exists(LOCAL_DB_PATH):
        return

    snapshot_path = f"{LOCAL_DB_PATH}_snapshot.db"
    try:
        source_conn = sqlite3.connect(LOCAL_DB_PATH)
        dest_conn = sqlite3.connect(snapshot_path)
        with dest_conn:
            source_conn.backup(dest_conn)
        dest_conn.close()
        source_conn.close()

        client = storage.Client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(GCS_DB_BLOB_NAME)
        blob.upload_from_filename(snapshot_path)
        print(
            f"[+] Database snapshot successfully backed up to gs://{GCS_BUCKET_NAME}/{GCS_DB_BLOB_NAME}"
        )
    except Exception as e:
        print(f"[-] Failed to sync database to GCS: {e}")
    finally:
        if os.path.exists(snapshot_path):
            try:
                os.remove(snapshot_path)
            except Exception:
                pass


_sync_task: asyncio.Task | None = None


def schedule_db_sync(delay_seconds: float = 45.0):
    """Debounces rapid sync requests within the debounce window."""
    global _sync_task

    if _sync_task and not _sync_task.done():
        _sync_task.cancel()

    async def _debounced_sync():
        try:
            await asyncio.sleep(delay_seconds)
            await asyncio.to_thread(sync_db_to_storage)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[-] Debounced sync error: {e}")

    try:
        loop = asyncio.get_running_loop()
        _sync_task = loop.create_task(_debounced_sync())
    except RuntimeError:
        pass


def _sigterm_handler(signum, frame):
    print("[*] SIGTERM received. Flushing database snapshot to GCS before exit...")
    sync_db_to_storage()


if hasattr(signal, "SIGTERM"):
    try:
        signal.signal(signal.SIGTERM, _sigterm_handler)
    except (ValueError, AttributeError):
        pass


init_db()


def get_auth_headers(backend_url: str) -> dict[str, str]:
    """Retrieves Google OIDC ID token if running inside GCP, otherwise returns empty headers."""
    headers = {}
    # Detect GCP environment or manual override
    audience = os.environ.get("BACKEND_AUDIENCE", backend_url)
    if os.environ.get("GCP_OIDC_AUTH", "").upper() == "TRUE" or os.environ.get(
        "K_SERVICE"
    ):
        try:
            import google.auth.transport.requests
            import google.oauth2.id_token

            auth_req = google.auth.transport.requests.Request()
            id_token = google.oauth2.id_token.fetch_id_token(
                auth_req, audience=audience
            )
            headers["Authorization"] = f"Bearer {id_token}"
        except Exception as e:
            print(f"[-] OIDC Token fetch failed: {e}")
    return headers


def _safe_db_retry(default=None):
    """Decorator that wraps SafeSQLAlchemyDataLayer methods with retry + exception shielding."""

    def decorator(fn):
        @functools.wraps(fn)
        async def wrapper(self, *args, **kwargs):
            for attempt in range(2):
                try:
                    return await fn(self, *args, **kwargs)
                except (
                    SQLAlchemyError,
                    OperationalError,
                    DatabaseError,
                    sqlite3.OperationalError,
                    sqlite3.DatabaseError,
                    OSError,
                ) as e:
                    print(
                        f"[-] SafeSQLAlchemyDataLayer.{fn.__name__} error (attempt {attempt+1}): {e}"
                    )
                    try:
                        await self.engine.dispose()
                    except Exception:
                        pass
                    if attempt == 1:
                        return default

        return wrapper

    return decorator


# --- Safe Data Layer Setup ---
class SafeSQLAlchemyDataLayer(SQLAlchemyDataLayer):
    """Subclasses Chainlit's SQLAlchemyDataLayer with engine pooling, retry logic, and exception shielding."""

    def __init__(
        self,
        conninfo: str,
        connect_args: dict[str, Any] | None = None,
        ssl_require: bool = False,
        storage_provider: Any | None = None,
        user_thread_limit: int | None = 1000,
        show_logger: bool | None = False,
    ):
        super().__init__(
            conninfo=conninfo,
            connect_args=connect_args,
            ssl_require=ssl_require,
            storage_provider=storage_provider,
            user_thread_limit=user_thread_limit,
            show_logger=show_logger,
        )
        connect_args_copy = dict(connect_args) if connect_args else {}
        self.engine: AsyncEngine = create_async_engine(
            self._conninfo,
            connect_args=connect_args_copy,
            pool_pre_ping=True,
            pool_recycle=300,
        )
        self.async_session = sessionmaker(
            bind=self.engine, expire_on_commit=False, class_=AsyncSession
        )

    async def get_current_timestamp(self) -> str:
        """Returns the current UTC timestamp formatted as ISO 8601 with Z suffix.

        Fixes Chainlit's naive datetime.now().isoformat() + 'Z' bug which caused
        local timestamps to be erroneously tagged as UTC, breaking chat history grouping.
        """
        return (
            datetime.datetime.now(datetime.UTC)
            .isoformat()
            .replace("+00:00", "Z")
        )

    async def _orig_get_thread(self, thread_id: str):
        return await super().get_thread(thread_id)

    @_safe_db_retry(default=None)
    async def get_thread(self, thread_id: str):
        return await self._orig_get_thread(thread_id)

    @_safe_db_retry(default=[])
    async def get_all_user_threads(
        self,
        user_id: str | None = None,
        thread_id: str | None = None,
    ):
        return await super().get_all_user_threads(
            user_id=user_id, thread_id=thread_id
        )

    @_safe_db_retry(default=None)
    async def get_user(self, identifier: str):
        return await super().get_user(identifier)

    @_safe_db_retry(default=None)
    async def create_step(self, step_dict: dict):
        return await super().create_step(step_dict)

    @_safe_db_retry(default=None)
    async def update_step(self, step_dict: dict):
        return await super().update_step(step_dict)

    @_safe_db_retry(default=None)
    async def update_thread(
        self,
        thread_id: str,
        name: str | None = None,
        user_id: str | None = None,
        metadata: dict | None = None,
        tags: list[str] | None = None,
    ):
        return await super().update_thread(
            thread_id, name, user_id, metadata, tags
        )


@cl.data_layer
def get_data_layer():
    """Configure SQLAlchemy data layer for conversation persistence."""
    return SafeSQLAlchemyDataLayer(conninfo=DATABASE_URL)


try:
    @cl.oauth_callback
    def oauth_callback(
        provider_id: str,
        token: str,
        raw_user_data: dict,
        default_user: cl.User,
    ) -> cl.User | None:
        """Handle Google OAuth login and restrict access to allowed email domains."""
        email = raw_user_data.get("email", "")
        domain = email.split("@")[-1] if "@" in email else ""
        if domain not in ALLOWED_DOMAINS:
            return None  # Deny access
        return default_user
except ValueError:
    # Optional in local development and unit tests where OAuth providers are not configured
    pass


def convert_img_tags_to_chainlit_images(msg: cl.Message) -> cl.Message:
    """Parses raw HTML <img> tags from the message and renders them natively as Chainlit inline Image elements."""
    if not msg.content:
        return msg

    soup = BeautifulSoup(msg.content, "html.parser")
    img_list = []

    found_imgs = soup.find_all("img")
    for img_tag in found_imgs:
        if img_tag.has_attr("src"):
            # Render the creative image natively in the Chat UI
            img = cl.Image(url=img_tag["src"], name="swatch", display="inline")
            img_list.append(img)
            # Remove the HTML tag so it does not render as a broken HTML image block
            img_tag.decompose()

    msg.elements = img_list
    cleaned_text = soup.get_text().strip()
    if cleaned_text:
        msg.content = cleaned_text
    elif img_list:
        # Prevent UI empty-content warnings if only images were outputted
        msg.content = " "
    return msg


@cl.set_starters
async def set_starters(user: cl.User | None = None):
    return [
        cl.Starter(
            label="Brand Feasibility Check",
            message="I'd like to run a brand feasibility check and verify some ad creatives. Can you guide me through the process and tell me exactly what information you need from me to get started?",
        ),
        cl.Starter(
            label="Core Functionalities",
            message="Hello! I'm new here. Can you briefly introduce yourself and explain your core functionalities? What kinds of analysis and reports can you generate for me?",
        ),
        cl.Starter(
            label="Supported Countries",
            message="Which countries are currently supported in the competitive advertising intelligence database?",
        ),
    ]


@cl.on_chat_start
async def on_chat_start():
    # Setup unique session ID for the user conversation
    session_id = str(uuid.uuid4())
    cl.user_session.set("session_id", session_id)
    cl.user_session.set("active_steps", {})
    cl.user_session.set("_processing", False)

    # Persist session_id in thread metadata so it can be restored on resume
    data_layer = cl_data._data_layer
    thread_id = cl.context.session.thread_id
    if data_layer and thread_id:
        try:
            await data_layer.update_thread(
                thread_id=thread_id, metadata={"session_id": session_id}
            )
        except Exception as e:
            print(f"Failed to update thread metadata: {e}")


@cl.on_chat_resume
async def on_chat_resume(thread: cl.types.ThreadDict):
    """Restore session state when resuming a previous conversation."""
    metadata = thread.get("metadata", {})
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except Exception:
            metadata = {}

    session_id = metadata.get("session_id") if isinstance(metadata, dict) else None

    if session_id:
        cl.user_session.set("session_id", session_id)
    else:
        # Fallback: generate a new session if metadata is missing
        cl.user_session.set("session_id", str(uuid.uuid4()))

    cl.user_session.set("active_steps", {})
    cl.user_session.set("_processing", False)


@cl.on_message
async def on_message(message: cl.Message):
    if cl.user_session.get("_processing"):
        await cl.Message(
            content="⏳ Please wait — I'm still processing your previous request.",
            author="Brand Analytics AI Agent",
        ).send()
        return

    cl.user_session.set("_processing", True)

    session_id = cl.user_session.get("session_id")
    active_steps = cl.user_session.get("active_steps", {})

    headers = get_auth_headers(BACKEND_URL)

    # Initialize the main response message
    current_message = cl.Message(content="", author="Brand Analytics AI Agent")

    try:
        async with httpx.AsyncClient() as client:
            async with aconnect_sse(
                client,
                "POST",
                f"{BACKEND_URL}/query/stream",
                json={
                    "message": message.content,
                    "session_id": session_id,
                    "user_id": cl.context.session.user.identifier
                    if cl.context.session.user
                    else "anonymous",
                },
                headers=headers,
                timeout=httpx.Timeout(600.0, connect=30.0),
            ) as event_source:
                resp = getattr(event_source, "response", None)
                if resp is not None:
                    if resp.status_code == 409:
                        await cl.Message(
                            content=(
                                "⏳ **The agent is still processing your previous request in the background.**\n\n"
                                "Refreshing the browser disconnected the live streaming view, but the task was not cancelled. "
                                "Please wait a moment for the current step to complete, then send your message again."
                            ),
                            author="Brand Analytics AI Agent",
                        ).send()
                        return
                    elif getattr(resp, "is_error", False):
                        resp.raise_for_status()

                async for sse_event in event_source.aiter_sse():
                    event = json.loads(sse_event.data)

                    # 1. Handle explicit backend notifications/trace metadata events silently
                    if (
                        isinstance(event, dict)
                        and "code" in event
                        and "message" in event
                    ):
                        print(
                            f"[Backend notification] Code {event.get('code')}: {event.get('message')}"
                        )
                        continue

                    # 2. Check for errors
                    if event.get("error_message"):
                        await cl.ErrorMessage(content=event["error_message"]).send()
                        continue

                    # 3. Extract content parts
                    content = event.get("content")
                    if content:
                        parts = content.get("parts", [])
                        for part in parts:
                            # 3.1 Handle textual chunks
                            text = part.get("text")
                            if text:
                                await current_message.stream_token(text)

                            # 3.2 Handle tool call starting
                            elif "function_call" in part:
                                call = part["function_call"]
                                tool_name = call.get("name")
                                args = call.get("args")

                                # Start a step in UI for the tool execution
                                friendly_name = TOOL_ALIASES.get(
                                    tool_name, tool_name.replace("_", " ").title()
                                )

                                step = cl.Step(name=friendly_name, type="tool")
                                step.input = json.dumps(args, indent=2)
                                await step.send()
                                active_steps[tool_name] = step

                            # 3.3 Handle tool call finishing
                            elif "function_response" in part:
                                resp = part["function_response"]
                                tool_name = resp.get("name")
                                response_content = resp.get("response")

                                # Finish and update the UI step
                                if tool_name in active_steps:
                                    step = active_steps[tool_name]

                                    # Wrap output in markdown code block for syntax highlighting and boxing
                                    formatted_json = json.dumps(
                                        response_content, indent=2
                                    )
                                    step.output = f"```json\n{formatted_json}\n```"

                                    await step.update()
                                    del active_steps[tool_name]

        # Post-process message text to convert <img> tags to native elements
        if current_message.content and current_message.content.strip():
            convert_img_tags_to_chainlit_images(current_message)
            # Send the final aggregated response message to terminate streaming state
            await current_message.send()
        elif active_steps:
            for _, step in list(active_steps.items()):
                step.output = "⚠️ Execution interrupted (the backend request timed out or disconnected)."
                await step.update()
            await cl.ErrorMessage(
                content="⚠️ The backend connection was closed before a final response was generated. If a long-running verification timed out, please retry."
            ).send()

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 409:
            await cl.Message(
                content=(
                    "⏳ **The agent is still processing your previous request in the background.**\n\n"
                    "Refreshing the browser disconnected the live streaming view, but the task was not cancelled. "
                    "Please wait a moment for the current step to complete, then send your message again."
                ),
                author="Brand Analytics AI Agent",
            ).send()
        else:
            await cl.ErrorMessage(
                content=f"Connection Error: Could not connect to agent backend. {e!s}"
            ).send()
    except Exception as e:
        err_msg = str(e)
        if (
            "409" in err_msg
            or "Expected response header Content-Type to contain 'text/event-stream'"
            in err_msg
        ):
            await cl.Message(
                content=(
                    "⏳ **The agent is still processing your previous request in the background.**\n\n"
                    "Refreshing the browser disconnected the live streaming view, but the task was not cancelled. "
                    "Please wait a moment for the current step to complete, then send your message again."
                ),
                author="Brand Analytics AI Agent",
            ).send()
        else:
            import traceback

            traceback.print_exc()
            await cl.ErrorMessage(
                content=f"Connection Error: Could not connect to agent backend. {err_msg}"
            ).send()
    finally:
        cl.user_session.set("_processing", False)
        schedule_db_sync()


@cl.on_feedback
async def on_feedback(feedback):
    """Capture user feedback and log it to GCS to correlate with OTEL traces."""
    bucket_name = os.environ.get("LOGS_BUCKET_NAME")
    if not bucket_name:
        print("[-] LOGS_BUCKET_NAME not set. Discarding feedback.")
        return

    session_id = getattr(cl.context.session, "id", "UnknownSession")
    message_id = feedback.forId
    value = feedback.value
    comment = feedback.comment or ""

    message_content = ""
    try:
        conn = sqlite3.connect(LOCAL_DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT output FROM steps WHERE id = ?", (message_id,))
        row = cursor.fetchone()
        if row:
            message_content = row[0]
        conn.close()
    except Exception as e:
        print(f"[-] Could not fetch message content: {e}")

    try:
        payload = {
            "session_id": session_id,
            "message_id": message_id,
            "value": value,
            "comment": comment,
            "message_content": message_content,
            "timestamp": datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z"),
        }

        # Write to GCS
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(f"feedbacks/{session_id}_{message_id}.json")
        blob.upload_from_string(
            json.dumps(payload, indent=2), content_type="application/json"
        )
        print(
            f"[+] Successfully logged feedback to gs://{bucket_name}/feedbacks/{session_id}_{message_id}.json"
        )
    except Exception as e:
        import traceback

        traceback.print_exc()
        print(f"[-] Failed to log feedback to GCS: {e}")
