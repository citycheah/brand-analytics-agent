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
"""Brand metrics computation tools (SOS, SOV, attribution)."""
import pandas as pd

from brand_analytics_app.tools.utils import (
    build_keyword_to_brand_map,
    normalize_brand_keywords_map,
)


def calculate_brand_metrics(
    bq_data: dict | list[dict], brand_keywords_map: dict
) -> dict:
    """Securely calculates Share of Voice (SOV) and Share of Spend (SOS) using pandas.
    Groups results per country market, resolving co-mentions.

    Args:
        bq_data: Raw BigQuery records (metadata dict with GCS Parquet path).
        brand_keywords_map: Dict mapping Brand -> List of keywords, or nested dict country -> Brand -> List of keywords.

    Returns:
        Structured metrics dictionary.
    """
    import brand_analytics_app.tools

    df = brand_analytics_app.tools._load_query_results(bq_data)

    if not brand_keywords_map:
        return {}

    brand_keywords_map, was_flat = normalize_brand_keywords_map(brand_keywords_map, df)
    is_nested = not was_flat

    results = {}

    for country, brands_map in brand_keywords_map.items():
        if not df.empty:
            country_col = (
                "country"
                if "country" in df.columns
                else ("country_name" if "country_name" in df.columns else None)
            )
            if country_col:
                df_country = df[df[country_col].str.lower() == country.lower()]
            else:
                df_country = df
        else:
            df_country = df

        bq_data_country = df_country.to_dict(orient="records")

        # Reverse keywords map for fast lookup
        keyword_to_brand = build_keyword_to_brand_map(brands_map)

        brand_spend = dict.fromkeys(brands_map, 0.0)
        brand_impressions = dict.fromkeys(brands_map, 0)
        brand_keywords_found = {brand: set() for brand in brands_map}

        # Process BQ rows for this country
        for row in bq_data_country:
            matched_str = row.get("matched_keywords", "")
            if not matched_str:
                continue

            kw_matches = [
                k.lower().strip() for k in matched_str.split(",") if k.strip()
            ]

            matched_brands = set()
            matched_clean_kws = []
            for kw in kw_matches:
                if kw in keyword_to_brand:
                    matched_brands.add(keyword_to_brand[kw])
                    matched_clean_kws.append(kw)

            if not matched_brands:
                continue

            split_factor = len(matched_brands)
            row_spend = float(row.get("spend", 0.0)) / split_factor
            row_impressions = int(row.get("impressions", 0)) / split_factor

            for brand in matched_brands:
                brand_spend[brand] += row_spend
                brand_impressions[brand] += row_impressions
                for kw in matched_clean_kws:
                    if kw in [k.lower().strip() for k in brands_map[brand]]:
                        brand_keywords_found[brand].add(kw)

        total_spend = sum(brand_spend.values())
        total_impressions = sum(brand_impressions.values())

        country_results = {}
        for brand in brands_map:
            spend = brand_spend[brand]
            impressions = brand_impressions[brand]

            sos = (spend / total_spend) * 100.0 if total_spend > 0 else 0.0
            sov = (
                (impressions / total_impressions) * 100.0
                if total_impressions > 0
                else 0.0
            )

            country_results[brand] = {
                "spend": round(spend, 2),
                "impressions": int(impressions),
                "share_of_spend": round(sos, 2),
                "share_of_impressions": round(sov, 2),
                "keywords": ", ".join(sorted(brand_keywords_found[brand])),
            }

        country_results["Total"] = {
            "spend": round(total_spend, 2),
            "impressions": int(total_impressions),
            "share_of_spend": 100.0,
            "share_of_impressions": 100.0,
            "keywords": "-",
        }

        results[country] = country_results

    results["status"] = "success"

    if not is_nested:
        if len(results) == 2:
            single_country_key = next(k for k in results.keys() if k != "status")
            flat_res = results[single_country_key]
            flat_res["status"] = "success"
            return flat_res

    return results


def _attribute_data_to_brands(df: pd.DataFrame, brands_map: dict) -> pd.DataFrame:
    """Attributes rows in df to brands using brand_keywords_map and handles co-mentions.

    Args:
        df: Pandas DataFrame containing the raw query results.
        brands_map: Dict mapping Brand -> List of keywords.

    Returns:
        Pandas DataFrame with rows attributed to a single 'brand' and spend/impressions split proportionally.
    """
    keyword_to_brand = build_keyword_to_brand_map(brands_map)

    attributed_rows = []
    bq_rows = df.to_dict(orient="records")
    for row in bq_rows:
        matched_str = row.get("matched_keywords", "")
        if not matched_str:
            continue

        kw_matches = [k.lower().strip() for k in matched_str.split(",") if k.strip()]

        matched_brands = set()
        for kw in kw_matches:
            if kw in keyword_to_brand:
                matched_brands.add(keyword_to_brand[kw])

        if not matched_brands:
            continue

        split_factor = len(matched_brands)
        row_spend = float(row.get("spend", 0.0)) / split_factor
        row_impressions = int(row.get("impressions", 0)) / split_factor

        for brand in matched_brands:
            new_row = dict(row)
            new_row["brand"] = brand
            new_row["spend"] = row_spend
            new_row["impressions"] = row_impressions
            new_row["creative_id"] = row.get("creative_id", "")
            attributed_rows.append(new_row)

    if attributed_rows:
        return pd.DataFrame(attributed_rows)
    return pd.DataFrame(
        columns=["brand", "spend", "impressions", "month", "creative_id"]
    )


def _calculate_brand_totals(country_df: pd.DataFrame, brands_map: dict) -> dict:
    """Calculates standard overall brand totals (spend, impressions, SOS %, SOV %)."""
    brand_totals = {}
    total_spend = 0.0
    total_impressions = 0

    brand_spend = dict.fromkeys(brands_map, 0.0)
    brand_impressions = dict.fromkeys(brands_map, 0)
    brand_keywords_found = {b: set() for b in brands_map}

    if not country_df.empty:
        for _, r in country_df.iterrows():
            b = r["brand"]
            brand_spend[b] += float(r["spend"])
            brand_impressions[b] += int(r["impressions"])

            matched_str = r.get("matched_keywords", "")
            kw_matches = [
                k.lower().strip() for k in matched_str.split(",") if k.strip()
            ]
            for kw in kw_matches:
                if kw in [k.lower().strip() for k in brands_map[b]]:
                    brand_keywords_found[b].add(kw)

        total_spend = sum(brand_spend.values())
        total_impressions = sum(brand_impressions.values())

    for brand in brands_map:
        spend = brand_spend[brand]
        impressions = brand_impressions[brand]
        sos = (spend / total_spend) * 100.0 if total_spend > 0 else 0.0
        sov = (
            (impressions / total_impressions) * 100.0 if total_impressions > 0 else 0.0
        )
        brand_totals[brand] = {
            "spend": round(spend, 2),
            "impressions": int(impressions),
            "share_of_spend": round(sos, 2),
            "share_of_impressions": round(sov, 2),
            "keywords": ", ".join(sorted(brand_keywords_found[brand])),
        }

    brand_totals["Total"] = {
        "spend": round(total_spend, 2),
        "impressions": int(total_impressions),
        "share_of_spend": 100.0,
        "share_of_impressions": 100.0,
        "keywords": "-",
    }
    return brand_totals
