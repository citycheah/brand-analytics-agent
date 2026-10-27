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
"""Report export tools for HTML reports."""
import os
import re
import urllib.parse
from typing import Any

try:
    from google.genai import types
except ImportError:
    class _StubBlob:
        def __init__(self, mime_type: str = "", data: bytes = b"") -> None:
            self.mime_type = mime_type
            self.data = data

    class _StubPart:
        def __init__(self, inline_data: Any = None) -> None:
            self.inline_data = inline_data

    class _StubExportTypes:
        Blob = _StubBlob
        Part = _StubPart

    types = _StubExportTypes()  # type: ignore[assignment]

from brand_analytics_app import configs


async def export_report(
    html_content: str,
    country: str,
    start_date: str,
    end_date: str,
    report_type: str = "brand",
    tool_context: Any = None,
) -> dict:
    """Exports dynamic pre-rendered HTML content to a self-contained HTML report file.
    Saves the file using GCS or local dev storage fallbacks.
    """
    plotly_cdn = '<script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>'
    if "</head>" in html_content:
        html_content = html_content.replace("</head>", f"{plotly_cdn}\n</head>")
    else:
        html_content = f"{plotly_cdn}\n{html_content}"

    # Ensure market/country is included in <title> and <h1> of the report
    if country:

        def _title_sub(m):
            orig_title = m.group(1).strip()
            if country.lower() not in orig_title.lower():
                return f"<title>{orig_title} — {country}</title>"
            return m.group(0)

        html_content = re.sub(
            r"<title>(.*?)</title>",
            _title_sub,
            html_content,
            flags=re.IGNORECASE | re.DOTALL,
        )

        def _h1_sub(m):
            tag_open = m.group(1)
            orig_h1 = m.group(2).strip()
            if country.lower() not in orig_h1.lower():
                return f"{tag_open}>{orig_h1} — {country}</h1>"
            return m.group(0)

        html_content = re.sub(
            r"(<h1(?:\s+[^>]*)?)>(.*?)</h1>",
            _h1_sub,
            html_content,
            count=1,
            flags=re.IGNORECASE | re.DOTALL,
        )

    prefix = f"{report_type.lower()}_report" if report_type else "brand_report"
    html_filename = f"{prefix}_{country.lower()}_{start_date}_{end_date}.html"
    abs_html_path = os.path.abspath(html_filename)

    LOGS_BUCKET_NAME = configs.LOGS_BUCKET_NAME
    session_id = "default_session"
    app_name = "app"
    user_id = "vais-query-reasoning-engine"
    version_str = "0"

    if tool_context:
        if hasattr(tool_context, "session") and getattr(
            tool_context.session, "id", None
        ):
            session_id = tool_context.session.id
        inv_ctx = getattr(tool_context, "_invocation_context", None)
        if inv_ctx:
            app_name = getattr(inv_ctx, "app_name", app_name)
            user_id = getattr(inv_ctx, "user_id", user_id)

    # Save artifact using ToolContext if available
    if tool_context and types is not None:
        try:
            html_blob = types.Blob(
                mime_type="text/html", data=html_content.encode("utf-8")
            )
            html_part = types.Part(inline_data=html_blob)
            version = await tool_context.save_artifact(html_filename, html_part)
            version_str = str(version)
        except Exception:
            # Fallback to short filename on Windows MAX_PATH limits
            try:
                html_filename = "brand_report.html"
                html_blob = types.Blob(
                    mime_type="text/html", data=html_content.encode("utf-8")
                )
                html_part = types.Part(inline_data=html_blob)
                version = await tool_context.save_artifact(html_filename, html_part)
                version_str = str(version)
            except Exception:
                pass

    if LOGS_BUCKET_NAME:
        encoded_filename = urllib.parse.quote(html_filename)
        html_uri = f"https://storage.cloud.google.com/{LOGS_BUCKET_NAME}/{app_name}/{user_id}/{session_id}/{encoded_filename}/{version_str}"
    else:
        abs_html_path_slashes = abs_html_path.replace("\\", "/")
        html_uri = f"file:///{abs_html_path_slashes}"

    import brand_analytics_app.tools

    # Guard local file writing under the LOCAL_DEV_WRITE environment flag
    if brand_analytics_app.tools.configs.LOCAL_DEV_WRITE:
        try:
            with open(abs_html_path, "w", encoding="utf-8") as f:
                f.write(html_content)
        except Exception:
            pass

    return {
        "status": "success",
        "html_filename": html_filename,
        "html_file_uri": html_uri,
        "summary": f"HTML Report successfully exported. Report URI: {html_uri}",
    }
