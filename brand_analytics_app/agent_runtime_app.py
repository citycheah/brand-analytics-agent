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
import pickle
from typing import Any

import vertexai
from google.adk.artifacts import GcsArtifactService, InMemoryArtifactService
from google.adk.events import Event
from google.adk.sessions import Session
from google.adk.sessions.in_memory_session_service import InMemorySessionService
from google.cloud import logging as google_cloud_logging
from google.cloud import storage
from vertexai.agent_engines.templates.adk import AdkApp

from brand_analytics_app import configs
from brand_analytics_app.agent import app as adk_app
from brand_analytics_app.app_utils.telemetry import setup_telemetry
from brand_analytics_app.app_utils.typing import Feedback


class GcsSessionService(InMemorySessionService):
    """Custom persistent session service that serializes session state to GCS or local files."""

    def __init__(self, bucket_name: str | None = None):
        super().__init__()
        self.bucket_name = bucket_name or configs.LOGS_BUCKET_NAME
        if configs.DATA_BACKEND == "local":
            self.bucket_name = None
        self.local_dir = os.path.join(os.getcwd(), ".sessions")
        if not self.bucket_name:
            os.makedirs(self.local_dir, exist_ok=True)
            logging.info(
                f"[SessionService] Using local file persistence at: {self.local_dir}"
            )
        else:
            try:
                self.storage_client = storage.Client()
                self.bucket = self.storage_client.bucket(self.bucket_name)
                logging.info(
                    f"[SessionService] Using GCS persistence at bucket: {self.bucket_name}"
                )
            except Exception:
                self.bucket_name = None
                os.makedirs(self.local_dir, exist_ok=True)
                logging.info(
                    f"[SessionService] Falling back to local file persistence at: {self.local_dir}"
                )

    def _get_gcs_blob(self, session_id: str):
        if self.bucket_name:
            return self.bucket.blob(f"adk_sessions/{session_id}.pkl")
        return None

    def _save_session(self, session: Session) -> None:
        data = pickle.dumps(session)
        blob = self._get_gcs_blob(session.id)
        if blob:
            try:
                blob.upload_from_string(data, content_type="application/octet-stream")
            except Exception as e:
                logging.error(f"[-] Failed to upload session {session.id} to GCS: {e}")
        else:
            filepath = os.path.join(self.local_dir, f"{session.id}.pkl")
            try:
                with open(filepath, "wb") as f:
                    f.write(data)
            except Exception as e:
                logging.error(f"[-] Failed to save session {session.id} locally: {e}")

    def _load_session(self, session_id: str) -> Session | None:
        blob = self._get_gcs_blob(session_id)
        if blob:
            try:
                if blob.exists():
                    data = blob.download_as_bytes()
                    return pickle.loads(data)
            except Exception as e:
                logging.error(
                    f"[-] Failed to download session {session_id} from GCS: {e}"
                )
        else:
            filepath = os.path.join(self.local_dir, f"{session_id}.pkl")
            if os.path.exists(filepath):
                try:
                    with open(filepath, "rb") as f:
                        return pickle.loads(f.read())
                except Exception as e:
                    logging.error(
                        f"[-] Failed to load session {session_id} locally: {e}"
                    )
        return None

    async def create_session(
        self,
        *,
        app_name: str,
        user_id: str,
        state: dict[str, Any] | None = None,
        session_id: str | None = None,
    ) -> Session:
        if session_id:
            existing = self._load_session(session_id)
            if existing:
                if app_name not in self.sessions:
                    self.sessions[app_name] = {}
                if user_id not in self.sessions[app_name]:
                    self.sessions[app_name][user_id] = {}
                self.sessions[app_name][user_id][session_id] = existing
                return self._merge_state(app_name, user_id, existing)

        session = await super().create_session(
            app_name=app_name, user_id=user_id, state=state, session_id=session_id
        )
        self._save_session(session)
        return session

    async def get_session(
        self,
        *,
        app_name: str,
        user_id: str,
        session_id: str,
        config: Any = None,
    ) -> Session | None:
        session = await super().get_session(
            app_name=app_name, user_id=user_id, session_id=session_id, config=config
        )
        if session:
            return session

        loaded = self._load_session(session_id)
        if loaded:
            if app_name not in self.sessions:
                self.sessions[app_name] = {}
            if user_id not in self.sessions[app_name]:
                self.sessions[app_name][user_id] = {}
            self.sessions[app_name][user_id][session_id] = loaded
            return await super().get_session(
                app_name=app_name, user_id=user_id, session_id=session_id, config=config
            )

        return None

    async def append_event(self, session: Session, event: Event) -> Event:
        evt = await super().append_event(session, event)
        self._save_session(session)
        return evt

    async def delete_session(
        self, *, app_name: str, user_id: str, session_id: str
    ) -> None:
        await super().delete_session(
            app_name=app_name, user_id=user_id, session_id=session_id
        )
        blob = self._get_gcs_blob(session_id)
        if blob:
            try:
                blob.delete(missing_ok=True)
            except Exception as e:
                logging.error(
                    f"[-] Failed to delete session {session_id} from GCS: {e}"
                )
        else:
            filepath = os.path.join(self.local_dir, f"{session_id}.pkl")
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except Exception as e:
                    logging.error(f"[-] Failed to delete local session file: {e}")


class AgentEngineApp(AdkApp):
    def set_up(self) -> None:
        """Initialize the agent engine app with logging and telemetry."""
        use_vertex = str(configs.GOOGLE_GENAI_USE_VERTEXAI).lower() not in ("false", "0")
        if use_vertex:
            try:
                vertexai.init()
            except Exception as e:
                logging.warning(f"Could not initialize vertexai: {e}")
        else:
            os.environ["GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY"] = "False"
        setup_telemetry()
        super().set_up()
        if not use_vertex:
            os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "False"
            # Invalidate any cached Vertex AI clients on models
            app_instance = self._tmpl_attrs.get("app")
            if app_instance and hasattr(app_instance, "root_agent"):
                def _reset_model(agent):
                    if hasattr(agent, "model") and hasattr(agent.model, "__dict__"):
                        agent.model.__dict__.pop("api_client", None)
                        agent.model.__dict__.pop("_api_backend", None)
                    for sub_tool in getattr(agent, "tools", []) or []:
                        sub_agent = getattr(sub_tool, "agent", None)
                        if sub_agent:
                            _reset_model(sub_agent)
                _reset_model(app_instance.root_agent)
                try:
                    from brand_analytics_app.agent import _search_sub_agent
                    _reset_model(_search_sub_agent)
                except Exception:
                    pass
        logging.basicConfig(level=logging.INFO)
        if use_vertex:
            try:
                logging_client = google_cloud_logging.Client()
                self.logger = logging_client.logger(__name__)
            except Exception:
                self.logger = logging.getLogger(__name__)
        else:
            self.logger = logging.getLogger(__name__)

    def register_feedback(self, feedback: dict[str, Any]) -> None:
        """Collect and log feedback."""
        feedback_obj = Feedback.model_validate(feedback)
        if hasattr(self.logger, "log_struct"):
            self.logger.log_struct(feedback_obj.model_dump(), severity="INFO")
        else:
            self.logger.info(f"Feedback received: {feedback_obj.model_dump()}")

    def register_operations(self) -> dict[str, list[str]]:
        """Registers the operations of the Agent."""
        operations = super().register_operations()
        operations[""] = [*operations.get("", []), "register_feedback"]
        return operations

    def clone(self) -> "AgentEngineApp":
        """Returns a clone of the Agent Runtime application."""
        return self


def build_artifact_service():
    logs_bucket = configs.LOGS_BUCKET_NAME
    if logs_bucket and configs.DATA_BACKEND != "local":
        try:
            return GcsArtifactService(bucket_name=logs_bucket)
        except Exception:
            pass
    return InMemoryArtifactService()


def build_session_service():
    return GcsSessionService()


# Ensure aiplatform project is initialized for AdkApp templates in local/API-key mode
try:
    import google.auth.credentials
    import google.cloud.aiplatform as aiplatform

    aiplatform.init(
        project=configs.GOOGLE_CLOUD_PROJECT or "local-demo-project",
        credentials=google.auth.credentials.AnonymousCredentials(),
    )
except Exception:
    pass

agent_runtime = AgentEngineApp(
    app=adk_app,
    artifact_service_builder=build_artifact_service,
    session_service_builder=build_session_service,
)
