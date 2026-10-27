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
"""Shared utility helpers and configuration aliases used across tool modules."""
import datetime
import logging

import pandas as pd

from brand_analytics_app import configs

logger = logging.getLogger("creative_verifier")

# Module-level config aliases
BQ_TABLE_NAME = configs.BQ_TABLE_NAME
BQ_BATCH_THRESHOLD_DAYS = configs.BQ_BATCH_THRESHOLD_DAYS
BQ_MAX_BYTES_BILLED = configs.BQ_MAX_BYTES_BILLED
SUPPORTED_COUNTRIES_RAW = configs.SUPPORTED_COUNTRIES_RAW
SUPPORTED_COUNTRIES = configs.SUPPORTED_COUNTRIES


def normalize_brand_keywords_map(
    brand_keywords_map: dict, df: pd.DataFrame
) -> tuple[dict, bool]:
    """Normalizes flat brand->keywords maps into nested country->brand->keywords.

    Returns:
        (nested_map, was_flat): The normalized map and whether the input was flat.
    """
    first_val = next(iter(brand_keywords_map.values()), None)
    if isinstance(first_val, dict):
        # Already nested: { "Germany": { "BMW": ["bmw", ...] } }
        return brand_keywords_map, False

    # Flat: { "BMW": ["bmw", ...] } — wrap per unique country
    country_col = (
        "country"
        if "country" in df.columns
        else ("country_name" if "country_name" in df.columns else None)
    )
    countries = (
        [c for c in df[country_col].dropna().unique().tolist() if c]
        if country_col
        else []
    )
    if not countries:
        countries = ["Unknown"]
    nested = {c: dict(brand_keywords_map) for c in countries}
    return nested, True


def build_keyword_to_brand_map(brands_map: dict[str, list[str]]) -> dict[str, str]:
    """Builds a reverse map from lowercase keyword -> brand name."""
    return {
        kw.lower().strip(): brand
        for brand, kws in brands_map.items()
        for kw in kws
    }


def calculate_scale_factor(start_date: str | None, end_date: str | None) -> float:
    """Calculates the date-range scale factor (relative to a 3-month baseline)."""
    days = 90
    if start_date and end_date:
        try:
            start_dt = datetime.date.fromisoformat(start_date)
            end_dt = datetime.date.fromisoformat(end_date)
            days = (end_dt - start_dt).days
        except Exception:
            pass
    months = max(1, round(days / 30.0))
    return months / 3.0
