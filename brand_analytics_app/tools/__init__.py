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
"""Brand Analytics Agent tools package.

All public symbols are re-exported here for backward compatibility.
Consumers can import from `brand_analytics_app.tools` as before.
"""
try:
    from google.genai import Client, types
except ImportError:
    Client = None  # type: ignore[assignment]
    types = None  # type: ignore[assignment]

from brand_analytics_app import configs
from brand_analytics_app.tools.bq_query import execute_bq_query
from brand_analytics_app.tools.cache import REPORT_CACHE
from brand_analytics_app.tools.creative_verification import (
    verify_creatives_multimodal,
)
from brand_analytics_app.tools.data_loader import (
    _get_query_template_path,
    _load_query_results,
    _load_verifications_from_uri,
    _persist_and_summarize_verifications,
    _resolve_creative_verifications,
    validate_and_sanitize_keywords,
)
from brand_analytics_app.tools.export import export_report
from brand_analytics_app.tools.feasibility import (
    check_brand_feasibility,
    get_feasibility_defaults,
    get_feasibility_thresholds,
)
from brand_analytics_app.tools.metrics import (
    _attribute_data_to_brands,
    _calculate_brand_totals,
    calculate_brand_metrics,
)
from brand_analytics_app.tools.report_html import (
    export_feasibility_report,
    generate_feasibility_report_html,
)
from brand_analytics_app.tools.report_metrics import (
    _calculate_channel_breakdowns,
    _calculate_creative_data,
    _calculate_monthly_trends,
    _calculate_publisher_data,
    calculate_report_metrics,
)
from brand_analytics_app.tools.sandbox import sandboxed_python_interpreter
from brand_analytics_app.tools.utils import (
    BQ_BATCH_THRESHOLD_DAYS,
    BQ_MAX_BYTES_BILLED,
    BQ_TABLE_NAME,
    SUPPORTED_COUNTRIES,
    SUPPORTED_COUNTRIES_RAW,
    logger,
)

__all__ = [
    "BQ_BATCH_THRESHOLD_DAYS",
    "BQ_MAX_BYTES_BILLED",
    "BQ_TABLE_NAME",
    "REPORT_CACHE",
    "SUPPORTED_COUNTRIES",
    "SUPPORTED_COUNTRIES_RAW",
    "Client",
    "_attribute_data_to_brands",
    "_calculate_brand_totals",
    "_calculate_channel_breakdowns",
    "_calculate_creative_data",
    "_calculate_monthly_trends",
    "_calculate_publisher_data",
    "_get_query_template_path",
    "_load_query_results",
    "_load_verifications_from_uri",
    "_persist_and_summarize_verifications",
    "_resolve_creative_verifications",
    "calculate_brand_metrics",
    "calculate_report_metrics",
    "check_brand_feasibility",
    "configs",
    "execute_bq_query",
    "export_feasibility_report",
    "export_report",
    "generate_feasibility_report_html",
    "get_feasibility_defaults",
    "get_feasibility_thresholds",
    "logger",
    "sandboxed_python_interpreter",
    "types",
    "validate_and_sanitize_keywords",
    "verify_creatives_multimodal",
]
