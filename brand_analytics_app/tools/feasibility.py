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
"""Campaign feasibility evaluation tools and threshold definitions."""
import datetime
import json

from brand_analytics_app import configs
from brand_analytics_app.tools.data_loader import (
    _resolve_creative_verifications,
)
from brand_analytics_app.tools.utils import (
    build_keyword_to_brand_map,
    calculate_scale_factor,
    normalize_brand_keywords_map,
)


def get_feasibility_defaults(country: str | None = None) -> tuple[float, int]:
    """Helper to resolve default spend and impressions thresholds from environment or defaults."""
    env_val = configs.FEASIBILITY_THRESHOLDS_JSON
    thresholds = {}
    if env_val:
        try:
            thresholds = json.loads(env_val)
        except Exception:
            pass

    # Normalize country key
    key = country.lower().strip() if country else "default"

    # Check environment variable first
    if key in thresholds:
        return float(thresholds[key].get("spend", 4500.0)), int(
            thresholds[key].get("impressions", 600000)
        )
    elif "default" in thresholds:
        return float(thresholds["default"].get("spend", 4500.0)), int(
            thresholds["default"].get("impressions", 600000)
        )

    # Global fallback
    return 4500.0, 600000


def get_feasibility_thresholds(
    country: str, start_date: str | None = None, end_date: str | None = None
) -> dict:
    """Retrieves the base and date-scaled feasibility thresholds (USD) for a target country market.

    Args:
        country: Target country name.
        start_date: Optional start date string (YYYY-MM-DD).
        end_date: Optional end date string (YYYY-MM-DD).

    Returns:
        A dictionary containing base and scaled spend/impressions thresholds.
    """
    base_spend, base_impressions = get_feasibility_defaults(country)

    days = 90
    if start_date and end_date:
        try:
            start_dt = datetime.date.fromisoformat(start_date)
            end_dt = datetime.date.fromisoformat(end_date)
            days = (end_dt - start_dt).days
        except Exception:
            pass

    months = max(1, round(days / 30.0))
    scale_factor = months / 3.0

    return {
        "country": country,
        "base_spend": base_spend,
        "base_impressions": base_impressions,
        "scaled_spend": round(base_spend * scale_factor, 2),
        "scaled_impressions": int(base_impressions * scale_factor),
        "scale_factor": round(scale_factor, 4),
        "months": months,
    }


def check_brand_feasibility(
    bq_data: dict | list[dict],
    brand_keywords_map: dict,
    spend_threshold: float | None = None,
    impressions_threshold: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    creative_verifications: list[dict] | dict | str | None = None,
    target_category: str | None = None,
) -> dict:
    """Evaluates whether each brand's campaign meets business feasibility thresholds.
    Scales the thresholds proportionally to the duration of the query (start_date to end_date) relative to a 3-month base.
    Groups evaluation partitioned by country market.

    Args:
        bq_data: Raw BigQuery records (metadata dict with GCS Parquet path).
        brand_keywords_map: Dict mapping Brand -> List of keywords, or nested dict country -> Brand -> List of keywords.
        spend_threshold: Target spend threshold override for feasibility.
        impressions_threshold: Target impressions threshold override for feasibility.
        start_date: Optional start date string (YYYY-MM-DD).
        end_date: Optional end date string (YYYY-MM-DD).
        creative_verifications: Optional creative ad validation results (list, dict with URI, or URI string).
        target_category: Optional product category filter.

    Returns:
        Dictionary mapping country -> Brand -> Feasibility details (or flat brand -> feasibility dict if input was flat).
    """
    if creative_verifications is None:
        if isinstance(bq_data, dict) and "verifications_uri" in bq_data:
            creative_verifications = bq_data
        elif isinstance(bq_data, str) and bq_data.endswith(".json"):
            creative_verifications = bq_data

    import brand_analytics_app.tools

    df = brand_analytics_app.tools._load_query_results(bq_data)

    if target_category is None and isinstance(creative_verifications, dict):
        target_category = creative_verifications.get("target_category")

    creative_verifications = _resolve_creative_verifications(creative_verifications)

    has_target_cat = bool(target_category and str(target_category).strip())
    norm_target_cat = str(target_category).strip().lower() if has_target_cat else None

    if not brand_keywords_map:
        return {}

    brand_keywords_map, was_flat = normalize_brand_keywords_map(brand_keywords_map, df)
    is_nested = not was_flat

    results = {}

    scale_factor = calculate_scale_factor(start_date, end_date)

    ver_by_url = (
        {v.get("url"): v for v in creative_verifications if v.get("url")}
        if creative_verifications
        else {}
    )

    for country_key, brands_map in brand_keywords_map.items():
        if not df.empty:
            country_col = (
                "country"
                if "country" in df.columns
                else ("country_name" if "country_name" in df.columns else None)
            )
            if country_col:
                df_country = df[df[country_col].str.lower() == country_key.lower()]
            else:
                df_country = df
        else:
            df_country = df

        bq_rows = df_country.to_dict(orient="records")

        # Resolve base thresholds specifically for this country key
        base_spend, base_impressions = get_feasibility_defaults(country_key)
        spend_t = spend_threshold if spend_threshold is not None else base_spend
        impressions_t = (
            impressions_threshold
            if impressions_threshold is not None
            else base_impressions
        )

        scaled_spend = spend_t * scale_factor
        scaled_impressions = impressions_t * scale_factor

        # Reverse keywords map for fast lookup
        keyword_to_brand = build_keyword_to_brand_map(brands_map)

        brand_spend = dict.fromkeys(brands_map, 0.0)
        brand_impressions = dict.fromkeys(brands_map, 0)

        # Process BQ rows for this country
        for row in bq_rows:
            url = row.get("creative_url_supplier", "") or row.get("url", "")
            if creative_verifications and not ver_by_url.get(url):
                continue
            if not creative_verifications and norm_target_cat:
                continue

            matched_str = row.get("matched_keywords", "")
            if not matched_str:
                matched_brand = row.get("matched_brand") or row.get("target_brand")
                if matched_brand:
                    matched_str = matched_brand

            kw_matches = [
                k.lower().strip() for k in matched_str.split(",") if k.strip()
            ]

            matched_brands = set()
            for kw in kw_matches:
                if kw in keyword_to_brand:
                    matched_brands.add(keyword_to_brand[kw])

            # Also check if matched_brand or target_brand directly matches brand_keywords_map
            if not matched_brands and ("matched_brand" in row or "target_brand" in row):
                row_brand = row.get("matched_brand") or row.get("target_brand")
                if row_brand:
                    for b in brands_map:
                        if b.lower().strip() == str(row_brand).lower().strip():
                            matched_brands.add(b)

            if not matched_brands:
                continue

            # Strict brand & category validation before calculating split factor
            if creative_verifications:
                ver = ver_by_url.get(url)
                if ver:
                    validated_brands = set()
                    for brand in matched_brands:
                        if ver.get("belongs_to_brand") is True:
                            ver_brand = ver.get("matched_brand") or ver.get("target_brand")
                            if ver_brand and ver_brand.lower().strip() != brand.lower().strip():
                                continue
                            if norm_target_cat:
                                ad_cat = str(ver.get("category") or "").lower().strip()
                                if ad_cat != norm_target_cat:
                                    continue
                            validated_brands.add(brand)
                    matched_brands = validated_brands

            if not matched_brands:
                continue

            split_factor = len(matched_brands)
            row_spend = float(row.get("spend", 0.0)) / split_factor
            row_impressions = int(row.get("impressions", 0)) / split_factor

            for brand in matched_brands:
                brand_spend[brand] += row_spend
                brand_impressions[brand] += row_impressions

        country_results = {}
        for brand in brands_map:
            spend = brand_spend[brand]
            impressions = brand_impressions[brand]

            is_feasible = (spend >= scaled_spend) or (impressions >= scaled_impressions)

            country_results[brand] = {
                "spend": round(spend, 2),
                "impressions": int(impressions),
                "spend_threshold": round(scaled_spend, 2),
                "impressions_threshold": int(scaled_impressions),
                "is_feasible": is_feasible,
            }

        results[country_key] = country_results

    results["status"] = "success"

    if not is_nested:
        if len(results) == 2:
            single_country_key = next(k for k in results.keys() if k != "status")
            flat_res = results[single_country_key]
            flat_res["status"] = "success"
            return flat_res

    return results
