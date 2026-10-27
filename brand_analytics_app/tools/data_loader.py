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
"""Data loading helpers for reading and persisting queries and creative verifications."""
import concurrent.futures
import json
import os
import tempfile
import time
import uuid
from io import BytesIO
from typing import Any

try:
    import google.auth
    from google.cloud import storage
except ImportError:
    google = None  # type: ignore[assignment]
    storage = None  # type: ignore[assignment]
import pandas as pd

from brand_analytics_app.tools.utils import logger


def _load_query_results(bq_data: Any) -> pd.DataFrame:
    """Helper to load query results from list of dicts, local Parquet file path, or GCS Parquet directory.

    Args:
        bq_data: Either a list of dicts, a dictionary handle containing 'gcs_uri' or 'verifications_uri',
                 or a string URI / JSON string.

    Returns:
        pandas DataFrame containing the data.
    """
    if isinstance(bq_data, str):
        bq_data_str = bq_data.strip()
        # Try JSON parsing if it looks like a JSON string
        if (bq_data_str.startswith("{") and bq_data_str.endswith("}")) or (
            bq_data_str.startswith("[") and bq_data_str.endswith("]")
        ):
            try:
                parsed = json.loads(bq_data_str)
                return _load_query_results(parsed)
            except Exception:
                pass

        # If it's a JSON file URI (e.g. verifications_uri)
        if bq_data_str.endswith(".json"):
            records = _load_verifications_from_uri(bq_data_str)
            return pd.DataFrame(records)

        # Treat as GCS or file URI
        bq_data = {"gcs_uri": bq_data_str}

    if isinstance(bq_data, list):
        return pd.DataFrame(bq_data)

    if isinstance(bq_data, dict):
        if "verifications_uri" in bq_data:
            records = _load_verifications_from_uri(bq_data["verifications_uri"])
            return pd.DataFrame(records)
        if "results" in bq_data and isinstance(bq_data["results"], list):
            return pd.DataFrame(bq_data["results"])
        if "gcs_uri" in bq_data:
            gcs_uri = bq_data["gcs_uri"]
            if gcs_uri.startswith("file://"):
                local_path = gcs_uri.replace("file://", "")
                if os.path.isdir(local_path):
                    dfs = []
                    for root, _, files in os.walk(local_path):
                        for f in files:
                            if f.endswith(".parquet"):
                                full_p = os.path.join(root, f)
                                df_chunk = pd.read_parquet(full_p)

                                # Parse hive partitions from path
                                rel_path = os.path.relpath(full_p, local_path)
                                for part in rel_path.replace("\\", "/").split("/"):
                                    if "=" in part:
                                        k, v = part.split("=", 1)
                                        df_chunk[k] = v
                                dfs.append(df_chunk)
                    df = pd.concat(dfs, ignore_index=True)
                    if not df.empty:
                        hashable_cols = []
                        for col in df.columns:
                            if col == "date_range":
                                continue
                            try:
                                df[col].duplicated()
                                hashable_cols.append(col)
                            except TypeError:
                                pass
                        if hashable_cols:
                            df = df.drop_duplicates(subset=hashable_cols)
                    return df
                else:
                    return pd.read_parquet(local_path)

            if gcs_uri.startswith("gs://"):
                start_time = time.time()
                without_gs = gcs_uri.replace("gs://", "")
                parts = without_gs.split("/")
                bucket_name = parts[0]
                prefix = "/".join(parts[1:])
                if "*" in prefix:
                    prefix = prefix.split("*")[0]

                credentials, project_id = google.auth.default()
                storage_client = storage.Client(
                    project=project_id, credentials=credentials
                )
                bucket = storage_client.bucket(bucket_name)
                blobs = list(storage_client.list_blobs(bucket, prefix=prefix))
                list_time = time.time() - start_time
                logger.info(
                    f"[TIMING] Listing GCS blobs took {list_time:.3f}s. Found {len(blobs)} blobs under prefix: {prefix}"
                )

                dfs = []
                dl_start = time.time()

                def download_and_parse(blob):
                    b_start = time.time()
                    data = blob.download_as_bytes()
                    df_chunk = pd.read_parquet(BytesIO(data))
                    for part in blob.name.split("/"):
                        if "=" in part:
                            k, v = part.split("=", 1)
                            df_chunk[k] = v
                    return df_chunk, b_start, blob.name

                with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                    futures = [
                        executor.submit(download_and_parse, b)
                        for b in blobs
                        if b.name.endswith(".parquet")
                    ]
                    for idx, future in enumerate(
                        concurrent.futures.as_completed(futures)
                    ):
                        df_chunk, b_start, b_name = future.result()
                        logger.info(
                            f"[TIMING] Downloaded & parsed blob {idx + 1}/{len(futures)} ({b_name}) in {time.time() - b_start:.3f}s"
                        )
                        dfs.append(df_chunk)

                logger.info(
                    f"[TIMING] Downloading all blobs took {time.time() - dl_start:.3f}s"
                )

                if not dfs:
                    return pd.DataFrame()

                df = pd.concat(dfs, ignore_index=True)
                if not df.empty:
                    hashable_cols = []
                    for col in df.columns:
                        if col == "date_range":
                            continue
                        try:
                            df[col].duplicated()
                            hashable_cols.append(col)
                        except TypeError:
                            pass
                    if hashable_cols:
                        df = df.drop_duplicates(subset=hashable_cols)
                return df
        elif "sample_rows" in bq_data:
            return pd.DataFrame(bq_data["sample_rows"])

    raise ValueError(f"Invalid query results format: {type(bq_data)}")


def _load_verifications_from_uri(uri: str) -> list[dict]:
    """Loads verification records from a GCS or local file URI.

    Args:
        uri: The URI pointing to the JSON file (file://, gs://, or local path).

    Returns:
        List of verification dictionaries.
    """
    if not uri:
        return []

    if uri.startswith("file://"):
        local_path = uri.replace("file://", "")
        if os.path.exists(local_path):
            try:
                with open(local_path, encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(
                    f"Could not load local verifications from {local_path}: {e}"
                )
                return []
        return []

    if uri.startswith("gs://"):
        without_gs = uri.replace("gs://", "")
        parts = without_gs.split("/", 1)
        bucket_name = parts[0]
        blob_name = parts[1] if len(parts) > 1 else ""

        try:
            credentials, project_id = google.auth.default()
            storage_client = storage.Client(project=project_id, credentials=credentials)
            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(blob_name)
            if not blob.exists():
                logger.warning(f"Creative verifications blob not found in GCS: {uri}")
                return []
            data = blob.download_as_text(encoding="utf-8")
            return json.loads(data)
        except Exception as e:
            logger.warning(
                f"Error loading creative verifications from GCS ({uri}): {e}"
            )
            return []

    if os.path.exists(uri):
        try:
            with open(uri, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Could not load verifications from {uri}: {e}")
            return []

    return []


def _resolve_creative_verifications(val: Any) -> list[dict]:
    """Normalizes creative verifications from any input format (list, dict handle, or URI).

    Args:
        val: Either list[dict], dict with 'verifications_uri' or 'verifications', or URI string.

    Returns:
        List of creative verification dictionaries.
    """
    if isinstance(val, list):
        return val
    if isinstance(val, dict):
        if val.get("verifications_uri"):
            return _load_verifications_from_uri(val["verifications_uri"])
        if "verifications" in val and isinstance(val["verifications"], list):
            return val["verifications"]
    if isinstance(val, str) and val:
        return _load_verifications_from_uri(val)
    return []


def _persist_and_summarize_verifications(
    final_results: list[dict], bq_data: Any, target_category: str | None = None
) -> dict:
    """Saves raw verification results to storage and computes a per-brand summary table.

    Args:
        final_results: Full list of verification dictionaries.
        bq_data: Raw BigQuery records or metadata dict containing 'gcs_uri'.
        target_category: Optional target category to categorize matching vs other brand ads.

    Returns:
        Dict containing status, verifications_uri, summary list, and optional target_category.
    """
    gcs_uri = None
    if isinstance(bq_data, dict):
        gcs_uri = bq_data.get("gcs_uri")

    verifications_uri = ""
    payload_json = json.dumps(final_results, indent=2)

    if gcs_uri and gcs_uri.startswith("gs://"):
        without_gs = gcs_uri.replace("gs://", "").rstrip("/")
        parts = without_gs.split("/", 1)
        bucket_name = parts[0]
        prefix = parts[1] if len(parts) > 1 else ""
        blob_path = (
            f"{prefix}/creative_verifications.json"
            if prefix
            else "creative_verifications.json"
        )

        try:
            credentials, project_id = google.auth.default()
            storage_client = storage.Client(project=project_id, credentials=credentials)
            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(blob_path)
            blob.upload_from_string(payload_json, content_type="application/json")
            verifications_uri = f"gs://{bucket_name}/{blob_path}"
        except Exception as e:
            logger.warning(
                f"Failed to upload creative verifications to GCS: {e}. Falling back to temp file."
            )
            gcs_uri = None

    if not verifications_uri:
        if gcs_uri and gcs_uri.startswith("file://"):
            local_dir = gcs_uri.replace("file://", "").rstrip("/\\")
            os.makedirs(local_dir, exist_ok=True)
            local_file = os.path.join(local_dir, "creative_verifications.json")
            with open(local_file, "w", encoding="utf-8") as f:
                f.write(payload_json)
            clean_local = local_file.replace("\\", "/")
            verifications_uri = f"file://{clean_local}"
        else:
            temp_dir = tempfile.gettempdir()
            filename = f"creative_verifications_{uuid.uuid4().hex}.json"
            local_file = os.path.join(temp_dir, filename)
            with open(local_file, "w", encoding="utf-8") as f:
                f.write(payload_json)
            clean_local = local_file.replace("\\", "/")
            verifications_uri = f"file://{clean_local}"

    # Build aggregated summary per (country, brand)
    summary_map = {}
    has_target_cat = bool(target_category and target_category.strip())
    norm_target_cat = target_category.strip().lower() if has_target_cat else ""

    for r in final_results:
        country = r.get("country", "Unknown")
        brand = r.get("target_brand") or r.get("matched_brand") or "Unknown"
        key = (country, brand)
        if key not in summary_map:
            entry = {
                "country": country,
                "brand": brand,
                "total_checked": 0,
            }
            if has_target_cat:
                entry["category_matches"] = 0
                entry["other_category"] = 0
                entry["other_brand_ads"] = 0
            else:
                entry["brand_matches"] = 0
                entry["other_brand_ads"] = 0
            summary_map[key] = entry

        summary_map[key]["total_checked"] += 1
        if has_target_cat:
            if r.get("belongs_to_brand", False):
                ad_cat = str(r.get("category", "")).strip().lower()
                if norm_target_cat in ad_cat:
                    summary_map[key]["category_matches"] += 1
                else:
                    summary_map[key]["other_category"] += 1
            else:
                summary_map[key]["other_brand_ads"] += 1
        else:
            if r.get("belongs_to_brand", False):
                summary_map[key]["brand_matches"] += 1
            else:
                summary_map[key]["other_brand_ads"] += 1

    summary_list = list(summary_map.values())

    res = {
        "status": "success",
        "verifications_uri": verifications_uri,
        "summary": summary_list,
    }
    if has_target_cat:
        res["target_category"] = target_category
    return res


def _get_query_template_path() -> str:
    """Helper to locate the canonical query_template.sql within the brand_analytics_app package."""
    # 1. Canonical location inside the brand_analytics_app package
    pkg_template = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "query_template.sql")
    )
    if os.path.exists(pkg_template):
        return pkg_template

    # 2. Repository root fallback
    repo_root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )
    root_template = os.path.join(repo_root, "query_template.sql")
    if os.path.exists(root_template):
        return root_template

    raise FileNotFoundError(
        f"Could not locate query_template.sql in package ({pkg_template}) or repo root ({root_template})."
    )


def validate_and_sanitize_keywords(identities: list[Any]) -> list[Any]:
    """Validates and sanitizes brand identities keywords.

    Rules:
    - Lowercase plain-text strings only. No regular expressions.
    - No leading @ for handles.
    - No keyword overlap (exact or substring) between different brands.
    - Precision over recall: avoid standalone generic dictionary words.
    """
    cleaned_identities = []
    brand_to_all_kws = {}

    for identity in identities:
        is_dict = isinstance(identity, dict)
        brand_name = identity["brand_name"] if is_dict else identity.brand_name
        handles = identity["handles"] if is_dict else identity.handles
        domains = identity["domains"] if is_dict else identity.domains
        aliases = identity["aliases"] if is_dict else identity.aliases

        clean_handles = []
        for h in handles:
            h_clean = h.lower().strip().lstrip("@")
            if h_clean:
                clean_handles.append(h_clean)

        clean_domains = []
        for d in domains:
            d_clean = d.lower().strip()
            if d_clean:
                clean_domains.append(d_clean)

        clean_aliases = []
        for a in aliases:
            a_clean = a.lower().strip()
            if a_clean:
                clean_aliases.append(a_clean)

        all_kws = set(clean_handles + clean_domains + clean_aliases)
        brand_to_all_kws[brand_name] = all_kws

        if is_dict:
            cleaned_identities.append(
                {
                    "brand_name": brand_name,
                    "handles": clean_handles,
                    "domains": clean_domains,
                    "aliases": clean_aliases,
                }
            )
        else:
            identity.handles = clean_handles
            identity.domains = clean_domains
            identity.aliases = clean_aliases
            cleaned_identities.append(identity)

    # Check overlaps between different brands
    brands = list(brand_to_all_kws.keys())
    for i in range(len(brands)):
        brand_a = brands[i]
        kws_a = brand_to_all_kws[brand_a]
        for j in range(i + 1, len(brands)):
            brand_b = brands[j]
            kws_b = brand_to_all_kws[brand_b]

            # 1. Exact match duplicate check
            common = kws_a.intersection(kws_b)
            if common:
                raise ValueError(
                    f"Duplicate keyword(s) {common} found across different brands: '{brand_a}' and '{brand_b}'."
                )

            # 2. Substring overlap check (both directions)
            for kw_a in kws_a:
                for kw_b in kws_b:
                    if kw_a in kw_b or kw_b in kw_a:
                        raise ValueError(
                            f"Keyword overlap detected: '{kw_a}' (from brand '{brand_a}') and '{kw_b}' (from brand '{brand_b}') overlap. Keywords must be unique to a single brand."
                        )

    return cleaned_identities
