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
"""BigQuery extraction and partitioning tool."""
import asyncio
import datetime
import json
import os
import re
import shutil
import tempfile
import uuid
from decimal import Decimal
from itertools import islice
from typing import Any

try:
    import google.auth
    from google.cloud import bigquery, storage
except ImportError:
    google = None  # type: ignore[assignment]
    bigquery = None  # type: ignore[assignment]
    storage = None  # type: ignore[assignment]
import pandas as pd

from brand_analytics_app import configs
from brand_analytics_app.tools.data_loader import _get_query_template_path
from brand_analytics_app.tools.utils import (
    SUPPORTED_COUNTRIES,
    SUPPORTED_COUNTRIES_RAW,
)


async def execute_bq_query(
    start_date: str,
    end_date: str,
    target_countries: list[str],
    include_keywords: list[str],
    exclude_keywords: list[str] | None = None,
    table_override: str | None = None,
    tool_context: Any = None,
) -> dict:
    """Queries BigQuery, exports results to a state-retaining GCS session folder partitioned by country/date_range, and returns a metadata handle.

    Args:
        start_date: ISO date string for start date (YYYY-MM-DD).
        end_date: ISO date string for end date (YYYY-MM-DD).
        target_countries: List of target country names to query.
        include_keywords: Flat list of plain-text keywords to query.
        exclude_keywords: List of brand plain-text keywords to exclude.
        table_override: Optional BQ table override.
        tool_context: Context injected by the runner to fetch session details.

    Returns:
        Dict handle containing the GCS URI, row count, schema, and preview rows.
    """
    # 0. Enforce date range check (table only contains data from 2025-01-01 onwards)
    if start_date < "2025-01-01":
        raise ValueError(
            "Data is only available from 2025-01-01 onwards. Please select a start date on or after 2025-01-01."
        )

    # 0.5. Enforce country/market whitelist validation
    for country in target_countries:
        if country.lower().strip() not in SUPPORTED_COUNTRIES:
            raise ValueError(
                f"Unsupported country/market: '{country}'. The database only contains competitive snapshot data for these 49 markets: {SUPPORTED_COUNTRIES_RAW.replace(';', ', ')}."
            )

    # 1. Enforce strict table name check
    table_name = table_override or configs.BQ_TABLE_NAME
    if not re.match(r"^[a-z0-9_.-]+$", table_name, re.IGNORECASE):
        raise ValueError("Invalid BQ_TABLE_NAME format")

    if not include_keywords or not target_countries:
        return {"gcs_uri": "", "schema": [], "row_count": 0, "preview_rows": []}

    # Combine exclude_keywords with default excludes to filter job/career listings
    default_excludes = ["job", "jobs", "vacancy", "vacancies", "career", "careers"]
    exclude_list = list(set((exclude_keywords or []) + default_excludes))

    # Parse date strings
    start = datetime.date.fromisoformat(start_date)
    end = datetime.date.fromisoformat(end_date)
    days_count = (end - start).days

    # Load SQL query template
    template_path = _get_query_template_path()
    template_content = await asyncio.to_thread(
        lambda: open(template_path, encoding="utf-8").read()
    )

    # Prepend WITH to make it valid SQL (since the template CTE begins with "PreFiltered AS")
    if not template_content.strip().upper().startswith("WITH"):
        match = re.search(r"PreFiltered\s+AS\s*\(", template_content, re.IGNORECASE)
        if match:
            start_idx = match.start()
            template_content = (
                template_content[:start_idx] + "WITH " + template_content[start_idx:]
            )

    # Inject table name securely using sanitization checks
    query_text = template_content.replace("{BQ_TABLE_NAME}", table_name)

    # 2. Block mutating SQL keywords
    blocked_keywords = [
        "INSERT",
        "UPDATE",
        "DELETE",
        "DROP",
        "ALTER",
        "MERGE",
        "CREATE",
        "TRUNCATE",
    ]
    for keyword in blocked_keywords:
        if re.search(rf"\b{keyword}\b", query_text, re.IGNORECASE):
            raise ValueError(
                f"SQL command blocked: mutating keyword '{keyword}' detected."
            )

    # Determine GCS parameters
    bucket_name = configs.LOGS_BUCKET_NAME
    is_local_backend = (
        configs.INTEGRATION_TEST or configs.DATA_BACKEND in ("local", "duckdb", "mock")
    )
    if not is_local_backend and not bucket_name:
        raise ValueError(
            "LOGS_BUCKET_NAME environment variable is not configured. A GCS bucket is required to execute BigQuery Extract jobs (or set DATA_BACKEND=local for offline/local demo mode)."
        )

    session_id = "default_session"
    app_name = "app"
    user_id = "default_user"
    if tool_context:
        if hasattr(tool_context, "session") and tool_context.session:
            session_id = tool_context.session.id
        inv_ctx = getattr(tool_context, "_invocation_context", None)
        if inv_ctx:
            app_name = getattr(inv_ctx, "app_name", app_name)
            user_id = getattr(inv_ctx, "user_id", user_id)

    # Determine batches
    batches = []
    threshold = configs.BQ_BATCH_THRESHOLD_DAYS
    if days_count > threshold:
        current_start = start
        while current_start <= end:
            current_end = min(current_start + datetime.timedelta(days=90), end)
            batches.append((current_start, current_end))
            current_start = current_end + datetime.timedelta(days=1)
    else:
        batches.append((start, end))

    # Local-First / Mock execution that bypasses live BigQuery connection
    if is_local_backend:
        # Load local dataset (Parquet if generated, fallback to tests/mocks/bq_mock_data.json)
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

        def read_local_dataset():
            parquet_path = os.path.join(repo_root, "data", "synthetic_ad_occurrences.parquet")
            if not configs.INTEGRATION_TEST and os.path.exists(parquet_path):
                return pd.read_parquet(parquet_path)
            mock_path = os.path.join(repo_root, "tests", "mocks", "bq_mock_data.json")
            with open(mock_path, encoding="utf-8") as f:
                return pd.DataFrame(json.load(f))

        df_mock = await asyncio.to_thread(read_local_dataset)

        # Filter by date range if 'month' or 'occurrence_collectiondate' is present and not in legacy unit test mode
        if not configs.INTEGRATION_TEST and not df_mock.empty:
            date_col = (
                "occurrence_collectiondate"
                if "occurrence_collectiondate" in df_mock.columns
                else ("month" if "month" in df_mock.columns else None)
            )
            if date_col:
                start_month_prefix = start_date[:7] + "-01"
                df_mock = df_mock[
                    (df_mock[date_col].astype(str) >= start_month_prefix)
                    & (df_mock[date_col].astype(str) <= end_date)
                ]

        # Filter mock data to only match countries/brands
        keywords = [kw.lower() for kw in include_keywords]
        excludes = [kw.lower() for kw in exclude_list if kw]

        if configs.INTEGRATION_TEST:
            base_dir = tempfile.gettempdir()
        else:
            base_dir = os.path.abspath(configs.LOCAL_STORAGE_DIR)
        session_dir = os.path.join(base_dir, f"session_{session_id}")

        # Process and save local data partitioned by country and date range
        df_final = pd.DataFrame()
        for country in target_countries:
            part_dir = os.path.join(
                session_dir, f"country={country}", f"date_range={start_date}_{end_date}"
            )
            if os.path.exists(part_dir):
                shutil.rmtree(part_dir, ignore_errors=True)
            os.makedirs(part_dir, exist_ok=True)

            df_country = df_mock[df_mock["country"].str.lower() == country.lower()].copy()

            def matches_kw(row_kw):
                if not isinstance(row_kw, str):
                    return False
                row_kws = [k.strip().lower() for k in row_kw.split(",") if k.strip()]
                if excludes and any(ex in rk for ex in excludes for rk in row_kws):
                    return False
                return any(k in keywords for k in row_kws)

            if "matched_keywords" in df_country.columns:
                df_country = df_country[
                    df_country["matched_keywords"].apply(matches_kw)
                ]

            if not df_country.empty:
                local_temp_file = os.path.join(
                    part_dir, f"results-batch0-{uuid.uuid4().hex}.parquet"
                )
                df_country.to_parquet(local_temp_file, index=False)
                df_final = pd.concat([df_final, df_country], ignore_index=True)

        schema = [{"name": col, "type": "STRING"} for col in df_mock.columns]
        session_dir_slashes = session_dir.replace("\\", "/")
        return {
            "status": "success",
            "gcs_uri": f"file://{session_dir_slashes}/",
            "schema": schema,
            "row_count": len(df_final),
            "preview_rows": df_final.head(10).to_dict(orient="records"),
        }

    # Initialize BigQuery Client and GCS Storage client
    credentials, project_id = google.auth.default()
    client = bigquery.Client(project=project_id, credentials=credentials)
    storage_client = storage.Client(project=project_id, credentials=credentials)
    max_bytes = configs.BQ_MAX_BYTES_BILLED

    # Overwrite protection: Clear existing blobs in target partitions to prevent duplicates
    if bucket_name:
        bucket = storage_client.bucket(bucket_name)
        for country in target_countries:
            prefix_to_clear = f"{app_name}/{user_id}/{session_id}/tmp_bq_extracts/country={country}/date_range={start_date}_{end_date}/"
            blobs_to_delete = list(bucket.list_blobs(prefix=prefix_to_clear))
            if blobs_to_delete:
                try:
                    bucket.delete_blobs(blobs_to_delete)
                except Exception:
                    pass

    total_rows = 0
    schema = []
    preview_rows = []
    sem = asyncio.Semaphore(5)

    async def execute_country_query(country: str):
        nonlocal total_rows, schema
        async with sem:
            for idx, (chunk_start, chunk_end) in enumerate(batches):
                query_params = [
                    bigquery.ScalarQueryParameter(
                        "start_date", "DATE", chunk_start.isoformat()
                    ),
                    bigquery.ScalarQueryParameter(
                        "end_date", "DATE", chunk_end.isoformat()
                    ),
                    bigquery.ArrayQueryParameter(
                        "target_countries", "STRING", [country]
                    ),
                    bigquery.ArrayQueryParameter(
                        "include_keywords", "STRING", include_keywords
                    ),
                    bigquery.ArrayQueryParameter(
                        "exclude_keywords", "STRING", exclude_list
                    ),
                ]

                job_config = bigquery.QueryJobConfig(
                    query_parameters=query_params, maximum_bytes_billed=max_bytes
                )

                try:
                    query_job = await asyncio.to_thread(
                        client.query, query_text, job_config=job_config
                    )
                    results = await asyncio.to_thread(query_job.result)

                    total_rows += results.total_rows
                    if not schema:
                        schema = [
                            {"name": field.name, "type": field.field_type}
                            for field in (query_job.schema or [])
                        ]
                        for row in islice(results, 10):
                            row_dict = {}
                            for key, val in row.items():
                                if isinstance(val, (datetime.date, datetime.datetime)):
                                    row_dict[key] = val.isoformat()
                                elif isinstance(val, Decimal):
                                    row_dict[key] = float(val)
                                elif isinstance(val, bytes):
                                    row_dict[key] = val.decode(
                                        "utf-8", errors="replace"
                                    )
                                else:
                                    row_dict[key] = val
                            preview_rows.append(row_dict)

                    if results.total_rows > 0:
                        destination_table = query_job.destination
                        batch_gcs_uri = f"gs://{bucket_name}/{app_name}/{user_id}/{session_id}/tmp_bq_extracts/country={country}/date_range={start_date}_{end_date}/results-batch{idx}-*.parquet"

                        extract_job_config = bigquery.ExtractJobConfig()
                        extract_job_config.destination_format = "PARQUET"

                        extract_job = await asyncio.to_thread(
                            client.extract_table,
                            destination_table,
                            batch_gcs_uri,
                            job_config=extract_job_config,
                        )
                        await asyncio.to_thread(extract_job.result)

                except Exception as e:
                    raise RuntimeError(
                        f"BigQuery query batch {idx} for country {country} failed: {e!s}"
                    ) from e

    tasks = [execute_country_query(country) for country in target_countries]
    await asyncio.gather(*tasks)

    gcs_session_root = (
        f"gs://{bucket_name}/{app_name}/{user_id}/{session_id}/tmp_bq_extracts/"
    )
    return {
        "status": "success",
        "gcs_uri": gcs_session_root,
        "schema": schema,
        "row_count": total_rows,
        "preview_rows": preview_rows,
    }
