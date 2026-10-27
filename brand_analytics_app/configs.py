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

import os

from dotenv import load_dotenv

load_dotenv()

# Force GOOGLE_CLOUD_LOCATION to global to ensure gemini resolves correctly without regional 404 errors
os.environ["GOOGLE_CLOUD_LOCATION"] = "global"


def __getattr__(name: str):
    """Dynamic lookup to support runtime overrides in unit tests (via monkeypatch)."""
    if name == "GOOGLE_CLOUD_PROJECT":
        if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
            try:
                import google.auth

                _, project_id = google.auth.default()
                if project_id:
                    os.environ["GOOGLE_CLOUD_PROJECT"] = project_id
            except Exception:
                pass
        return os.environ.get("GOOGLE_CLOUD_PROJECT")

    elif name == "GOOGLE_CLOUD_LOCATION":
        return "global"

    elif name == "GOOGLE_GENAI_USE_VERTEXAI":
        return os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "True")

    elif name == "LOGS_BUCKET_NAME":
        return os.environ.get("LOGS_BUCKET_NAME")

    elif name == "BQ_TABLE_NAME":
        return os.environ.get(
            "BQ_TABLE_NAME",
            "your-gcp-project.brand_analytics.competitive_ad_occurrences",
        )

    elif name == "BQ_BATCH_THRESHOLD_DAYS":
        try:
            return int(os.environ.get("BQ_BATCH_THRESHOLD_DAYS", "180"))
        except (TypeError, ValueError):
            return 180

    elif name == "BQ_MAX_BYTES_BILLED":
        try:
            return int(os.environ.get("BQ_MAX_BYTES_BILLED", "200000000000"))
        except (TypeError, ValueError):
            return 200000000000

    elif name in ("SUPPORTED_COUNTRIES_RAW", "SUPPORTED_COUNTRIES"):
        _raw_env = os.environ.get(
            "SUPPORTED_COUNTRIES",
            "Argentina;Australia;Austria;Belgium;Brazil;Canada;Chile;Colombia;Czech Republic;"
            "Denmark;Egypt;Finland;France;Germany;Greece;Hong Kong;Hungary;India;Indonesia;"
            "Ireland;Israel;Italy;Japan;Korea, Republic of;Kuwait;Lithuania;Malaysia;Mexico;"
            "Netherlands;New Zealand;Norway;Philippines;Poland;Portugal;Qatar;Romania;"
            "Saudi Arabia;Singapore;South Africa;Spain;Sweden;Switzerlands;"
            "Taiwan, Province of China;Thailand;Turkey;United Arab Emirates;United Kingdom;"
            "United States;Vietnam",
        )
        _countries_list = [
            c.strip() for c in _raw_env.replace("\n", "").split(";") if c.strip()
        ]
        if name == "SUPPORTED_COUNTRIES_RAW":
            return ";".join(_countries_list)
        else:
            return {c.lower() for c in _countries_list}

    elif name == "FEASIBILITY_THRESHOLDS_JSON":
        return os.environ.get("FEASIBILITY_THRESHOLDS_JSON")

    elif name == "VERIFY_CREATIVES_BATCH_SIZE":
        try:
            return int(os.environ.get("VERIFY_CREATIVES_BATCH_SIZE", "5"))
        except (TypeError, ValueError):
            return 5

    elif name == "VERIFY_CREATIVES_CONCURRENCY_LIMIT":
        try:
            return int(os.environ.get("VERIFY_CREATIVES_CONCURRENCY_LIMIT", "10"))
        except (TypeError, ValueError):
            return 10

    elif name == "LOCAL_DEV_WRITE":
        return str(os.environ.get("LOCAL_DEV_WRITE", "")).upper() == "TRUE"

    elif name == "MAX_CREATIVE_VERIFICATIONS_PER_BRAND":
        try:
            return int(os.environ.get("MAX_CREATIVE_VERIFICATIONS_PER_BRAND", "100"))
        except (TypeError, ValueError):
            return 100

    elif name == "INTEGRATION_TEST":
        return os.environ.get("INTEGRATION_TEST") == "TRUE"

    elif name == "DATA_BACKEND":
        return os.environ.get("DATA_BACKEND", "bigquery").lower().strip()

    elif name == "LOCAL_STORAGE_DIR":
        return os.environ.get("LOCAL_STORAGE_DIR", "local_storage")

    elif name == "GEMINI_MODEL_NAME":
        return os.environ.get("GEMINI_MODEL_NAME", "gemini-2.5-flash")

    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
