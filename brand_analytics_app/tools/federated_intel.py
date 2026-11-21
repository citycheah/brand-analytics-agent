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
"""Federated lakehouse ADK tools and Portal service helpers powered by `intel-core`."""

from __future__ import annotations

import json
import math
import re
import time
from io import BytesIO
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd
from intel_core.evals import DEFAULT_GOLDEN_MANIFEST_PATH, load_golden_manifest
from intel_core.gemini import summarize_ledger
from intel_core.optimize import simulate_budget_reallocation
from intel_core.schemas import (
    OverrideFieldName,
    OverrideTargetType,
    canonicalize_brand_id,
    country_display_name,
    normalize_country_iso,
)
from intel_core.storage import (
    HumanOverrideStore,
    read_parquet_table,
    register_live_dissection_view,
)
from PIL import Image, ImageDraw

from brand_analytics_app import configs
from brand_analytics_app.tools.cache import REPORT_CACHE


def get_lakehouse_root() -> Path:
    """Returns the configured local Hive/Parquet lakehouse root directory."""
    return Path(configs.INTEL_LAKEHOUSE_DIR).resolve()


def get_velocity_gold_dir() -> Path:
    """Returns the configured Gold velocity output directory."""
    return Path(configs.VELOCITY_GOLD_DIR).resolve()


def _resolve_dissection_path(lakehouse: Path) -> Path:
    silver_path = lakehouse / "silver" / "dim_creative_dissection"
    if silver_path.exists():
        return silver_path
    return lakehouse / "bronze" / "seed_creative_dissection"


def _resolve_themes_path(lakehouse: Path) -> Path:
    for candidate in (
        lakehouse / "gold" / "dim_creative_themes",
        lakehouse / "silver" / "dim_creative_themes",
        lakehouse / "bronze" / "seed_creative_themes",
    ):
        if candidate.exists():
            return candidate
    return lakehouse / "bronze" / "seed_creative_themes"


def _clean_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Converts a DataFrame into JSON-safe Python dicts with ISO dates and no NaNs."""
    if df.empty:
        return []
    records = df.to_dict(orient="records")
    cleaned: list[dict[str, Any]] = []
    for row in records:
        out: dict[str, Any] = {}
        for k, v in row.items():
            if hasattr(v, "tolist") and not isinstance(v, str | bytes):
                v = v.tolist()
            if isinstance(v, list):
                out[k] = [str(item) for item in v]
            elif pd.isna(v) if not isinstance(v, list | dict) else False:
                out[k] = None
            elif hasattr(v, "isoformat"):
                out[k] = v.isoformat()
            elif hasattr(v, "item"):
                out[k] = v.item()
            else:
                out[k] = v
        cleaned.append(out)
    return cleaned


def _finite_float(val: Any) -> float | None:
    """Returns a finite Python float or None for missing / NaN / infinite scalars."""
    if val is None or pd.isna(val):
        return None
    num = float(val)
    return num if math.isfinite(num) else None


def _safe_bool(val: Any) -> bool:
    """Converts scalar values cleanly while treating None / NaN / pd.NA as False."""
    if val is None or pd.isna(val):
        return False
    return bool(val)


def _safe_country_iso(country: str | None) -> str:
    raw = (country or "DE").strip()
    if len(raw) == 2 and raw.isalpha():
        return normalize_country_iso(raw)
    return normalize_country_iso(raw)


def _compute_audit_coverage_by_brand(lakehouse: Path) -> dict[str, dict[str, Any]]:
    con = duckdb.connect(":memory:")
    try:
        themes_path = _resolve_themes_path(lakehouse)
        view_name = register_live_dissection_view(
            con,
            assets_path=lakehouse / "silver" / "dim_creative_asset",
            dissection_path=_resolve_dissection_path(lakehouse),
            overrides_dir=lakehouse / "overrides",
            themes_path=themes_path if themes_path.exists() else None,
        )
        rows = con.execute(
            f"""
            SELECT
                COALESCE(NULLIF(matched_brand_id, ''), NULLIF(evaluated_brand_id, ''), brand_id_raw) AS brand_id,
                COUNT(DISTINCT asset_id) AS total_assets,
                COUNT(DISTINCT CASE WHEN belongs_to_brand = TRUE THEN asset_id END) AS verified_assets,
                COUNT(DISTINCT CASE WHEN has_human_override = TRUE THEN asset_id END) AS overridden_assets
            FROM {view_name}
            GROUP BY 1
            """
        ).fetchdf()
    finally:
        con.close()

    result: dict[str, dict[str, Any]] = {}
    for _, row in rows.iterrows():
        brand = str(row["brand_id"] or "")
        total = max(1, int(row["total_assets"] or 0))
        verified = int(row["verified_assets"] or 0)
        overridden = int(row["overridden_assets"] or 0)
        result[brand] = {
            "total_assets": int(row["total_assets"] or 0),
            "verified_assets": verified,
            "overridden_assets": overridden,
            "audit_coverage_pct": round(100.0 * verified / total, 2),
        }
    return result


def query_federated_sos_sov(
    brand_ids: list[str] | None = None,
    country: str = "Germany",
    start_month: str | None = None,
    end_month: str | None = None,
) -> dict[str, Any]:
    """Queries Gold SOS/SOV performance and live DuckDB audit coverage from the federated lakehouse.

    Args:
        brand_ids: Optional list of brand names to filter (e.g. ["BMW", "Mercedes-Benz"]).
        country: Target country name or ISO code (default: "Germany").
        start_month: Optional inclusive ISO date/month start filter (e.g. "2025-01-01").
        end_month: Optional inclusive ISO date/month end filter (e.g. "2026-12-31").

    Returns:
        Dict with brand totals, monthly trend series, `audit_coverage_pct`, and modeled-spend disclosures.
    """
    lakehouse = get_lakehouse_root()
    country_iso = _safe_country_iso(country)
    gold_df = read_parquet_table(lakehouse / "gold" / "gold_brand_monthly", table_name="gold_brand_monthly")
    if gold_df.empty:
        return {
            "status": "empty",
            "country_iso": country_iso,
            "country_name": country_display_name(country_iso),
            "total_spend_usd": 0.0,
            "total_impressions": 0,
            "brands": [],
            "monthly_series": [],
            "audit_coverage_pct": 0.0,
        }

    canon_brands = {canonicalize_brand_id(b) for b in brand_ids} if brand_ids else None
    con = duckdb.connect(":memory:")
    try:
        con.register("gold_brand_monthly_tbl", gold_df)
        clauses = ["country_iso = ?"]
        params: list[Any] = [country_iso]
        if start_month:
            clauses.append("CAST(month_start AS VARCHAR) >= ?")
            params.append(start_month[:10])
        if end_month:
            clauses.append("CAST(month_start AS VARCHAR) <= ?")
            params.append(end_month[:10])
        if canon_brands:
            placeholders = ", ".join(["?"] * len(canon_brands))
            clauses.append(f"brand_id IN ({placeholders})")
            params.extend(sorted(canon_brands))
        where_sql = " AND ".join(clauses)

        monthly_df = con.execute(
            f"""
            SELECT
                CAST(month_start AS VARCHAR) AS month_start,
                country_iso,
                brand_id,
                spend_usd,
                impressions,
                sos_pct,
                sov_pct,
                audit_coverage_pct,
                creative_count
            FROM gold_brand_monthly_tbl
            WHERE {where_sql}
            ORDER BY month_start ASC, spend_usd DESC
            """,
            params,
        ).fetchdf()

        totals_df = con.execute(
            f"""
            SELECT
                brand_id,
                ROUND(SUM(spend_usd), 2) AS total_spend_usd,
                ROUND(SUM(impressions), 0) AS total_impressions,
                ROUND(AVG(audit_coverage_pct) * 100.0, 2) AS gold_audit_coverage_pct,
                MAX(creative_count) AS peak_creatives_per_month
            FROM gold_brand_monthly_tbl
            WHERE {where_sql}
            GROUP BY brand_id
            ORDER BY total_spend_usd DESC
            """,
            params,
        ).fetchdf()
    finally:
        con.close()

    total_spend = float(totals_df["total_spend_usd"].sum()) if not totals_df.empty else 0.0
    total_impr = float(totals_df["total_impressions"].sum()) if not totals_df.empty else 0.0
    live_audit = _compute_audit_coverage_by_brand(lakehouse)

    brands_out: list[dict[str, Any]] = []
    for _, row in totals_df.iterrows():
        b_id = str(row["brand_id"])
        sp = float(row["total_spend_usd"] or 0.0)
        imp = float(row["total_impressions"] or 0.0)
        live_cov = live_audit.get(b_id, {}).get("audit_coverage_pct", float(row["gold_audit_coverage_pct"] or 0.0))
        brands_out.append(
            {
                "brand_id": b_id,
                "total_spend_usd": round(sp, 2),
                "total_impressions": int(imp),
                "sos_pct": round(100.0 * sp / total_spend, 2) if total_spend > 0 else 0.0,
                "sov_pct": round(100.0 * imp / total_impr, 2) if total_impr > 0 else 0.0,
                "audit_coverage_pct": live_cov,
                "overridden_assets": live_audit.get(b_id, {}).get("overridden_assets", 0),
                "peak_creatives_per_month": int(row["peak_creatives_per_month"] or 0),
            }
        )

    avg_cov = (
        round(sum(b["audit_coverage_pct"] for b in brands_out) / len(brands_out), 2)
        if brands_out
        else 0.0
    )
    return {
        "status": "success",
        "country_iso": country_iso,
        "country_name": country_display_name(country_iso),
        "total_spend_usd": round(total_spend, 2),
        "total_impressions": int(total_impr),
        "audit_coverage_pct": avg_cov,
        "currency": "USD",
        "brands": brands_out,
        "monthly_series": _clean_records(monthly_df),
    }


def get_creative_themes_and_fatigue(
    country: str = "Germany",
    brand_id: str | None = None,
) -> dict[str, Any]:
    """Computes category HHI, brand Jaccard overlap, Battleground vs Whitespace themes, and creative fatigue.

    Args:
        country: Target country name or ISO code (default: "Germany").
        brand_id: Optional brand identifier filter.

    Returns:
        Dict with `category_hhi`, `jaccard_overlaps`, `themes`, `scatter_points`, and `fatigue_alerts`.
    """
    lakehouse = get_lakehouse_root()
    country_iso = _safe_country_iso(country)
    theme_weekly = read_parquet_table(
        lakehouse / "gold" / "gold_theme_spend_weekly", table_name="gold_theme_spend_weekly"
    )
    dim_themes = read_parquet_table(_resolve_themes_path(lakehouse))
    assets_df = read_parquet_table(lakehouse / "silver" / "dim_creative_asset", table_name="dim_creative_asset")
    delivery_df = read_parquet_table(
        lakehouse / "gold" / "fct_ad_delivery_weekly", table_name="fct_ad_delivery_weekly"
    )

    if theme_weekly.empty:
        return {
            "status": "empty",
            "country_iso": country_iso,
            "country_name": country_display_name(country_iso),
            "category_hhi": 0.0,
            "hhi_concentration": "Competitive",
            "themes": [],
            "jaccard_overlaps": [],
            "scatter_points": [],
            "fatigue_alerts": [],
        }

    canon_brand = canonicalize_brand_id(brand_id) if brand_id else None

    con = duckdb.connect(":memory:")
    try:
        con.register("theme_weekly_tbl", theme_weekly)
        # 1. HHI over theme spend shares + Battleground vs Whitespace summary
        theme_summary = con.execute(
            """
            SELECT
                theme_id,
                theme_label,
                ROUND(SUM(theme_spend_usd), 2) AS total_spend_usd,
                ROUND(SUM(theme_impressions), 0) AS total_impressions,
                COUNT(DISTINCT brand_id) AS participating_brands,
                LIST(DISTINCT brand_id) AS brands
            FROM theme_weekly_tbl
            WHERE country_iso = ?
            GROUP BY theme_id, theme_label
            ORDER BY total_spend_usd DESC
            """,
            [country_iso],
        ).fetchdf()

        brand_theme_df = con.execute(
            """
            SELECT
                brand_id,
                theme_label,
                ROUND(SUM(theme_spend_usd), 2) AS spend_usd
            FROM theme_weekly_tbl
            WHERE country_iso = ?
            GROUP BY brand_id, theme_label
            ORDER BY brand_id ASC, spend_usd DESC
            """,
            [country_iso],
        ).fetchdf()
    finally:
        con.close()

    total_theme_spend = float(theme_summary["total_spend_usd"].sum()) if not theme_summary.empty else 0.0
    hhi = 0.0
    themes_out: list[dict[str, Any]] = []
    for _, row in theme_summary.iterrows():
        sp = float(row["total_spend_usd"] or 0.0)
        share = (100.0 * sp / total_theme_spend) if total_theme_spend > 0 else 0.0
        hhi += share * share
        n_brands = int(row["participating_brands"] or 0)
        scope = "shared_battleground" if n_brands >= 2 else "brand_exclusive_whitespace"
        raw_brands = row["brands"]
        brands_iter = raw_brands.tolist() if hasattr(raw_brands, "tolist") else (raw_brands or [])
        brands_list = sorted(str(b) for b in brands_iter)
        if canon_brand and canon_brand not in brands_list:
            continue
        themes_out.append(
            {
                "theme_id": str(row["theme_id"]),
                "theme_label": str(row["theme_label"]),
                "scope": scope,
                "participating_brands": n_brands,
                "brands": brands_list,
                "spend_usd": round(sp, 2),
                "impressions": int(row["total_impressions"] or 0),
                "share_pct": round(share, 2),
            }
        )

    # Brand-pair Jaccard similarity over active themes
    brand_to_themes: dict[str, set[str]] = {}
    for _, row in brand_theme_df.iterrows():
        if float(row["spend_usd"] or 0.0) > 0:
            brand_to_themes.setdefault(str(row["brand_id"]), set()).add(str(row["theme_label"]))

    brand_names = sorted(brand_to_themes.keys())
    jaccard_pairs: list[dict[str, Any]] = []
    for idx, b1 in enumerate(brand_names):
        for b2 in brand_names[idx + 1 :]:
            s1, s2 = brand_to_themes[b1], brand_to_themes[b2]
            union = s1 | s2
            sim = (len(s1 & s2) / len(union)) if union else 0.0
            jaccard_pairs.append(
                {
                    "brand_a": b1,
                    "brand_b": b2,
                    "jaccard_similarity": round(sim, 4),
                    "shared_themes": sorted(s1 & s2),
                }
            )

    # Creative lifespan & fatigue flags (Gold creative_fatigue if available, else >=8 weeks & <=0.55 decay)
    fatigue_alerts: list[dict[str, Any]] = []
    if not delivery_df.empty:
        asset_meta: dict[str, dict[str, str]] = {}
        con_meta = duckdb.connect(":memory:")
        try:
            themes_path = _resolve_themes_path(lakehouse)
            live_view = register_live_dissection_view(
                con_meta,
                assets_path=lakehouse / "silver" / "dim_creative_asset",
                dissection_path=_resolve_dissection_path(lakehouse),
                overrides_dir=lakehouse / "overrides",
                themes_path=themes_path if themes_path.exists() else None,
            )
            meta_df = con_meta.execute(
                f"""
                SELECT
                    asset_id,
                    media_hash_key,
                    COALESCE(NULLIF(theme_label, ''), 'Unclustered') AS theme_label,
                    COALESCE(NULLIF(matched_brand_id, ''), NULLIF(evaluated_brand_id, ''), brand_id_raw) AS focal_brand_id
                FROM {live_view}
                """
            ).fetchdf()
            for _, mrow in meta_df.iterrows():
                asset_meta[str(mrow["asset_id"])] = {
                    "media_hash_key": str(mrow["media_hash_key"] or ""),
                    "theme_label": str(mrow["theme_label"] or "Unclustered"),
                    "focal_brand_id": str(mrow["focal_brand_id"] or ""),
                }
        finally:
            con_meta.close()

        gold_fatigue_path = lakehouse / "gold" / "themes_analytics" / "creative_fatigue"
        gold_fatigue_df = (
            read_parquet_table(gold_fatigue_path, table_name="creative_fatigue")
            if gold_fatigue_path.exists()
            else pd.DataFrame()
        )
        gold_fatigue_map: dict[tuple[str, str], dict[str, Any]] = {}
        if not gold_fatigue_df.empty:
            for _, grow in gold_fatigue_df.iterrows():
                gold_fatigue_map[(str(grow["brand_id"]), str(grow["media_hash_key"]))] = grow.to_dict()

        del_work = delivery_df[delivery_df["country_iso"] == country_iso].copy()
        if canon_brand:
            del_work = del_work[del_work["brand_id"] == canon_brand]

        if not del_work.empty:
            del_work["week_dt"] = pd.to_datetime(del_work["week_start"])
            for (aid_raw, bid_raw, ch_raw), grp in del_work.sort_values("week_dt").groupby(
                ["asset_id", "brand_id", "channel_group"]
            ):
                aid = str(aid_raw)
                bid = str(bid_raw)
                ch = str(ch_raw)
                n_weeks = int(grp["week_dt"].nunique())
                span_weeks = max(1, int((grp["week_dt"].max() - grp["week_dt"].min()).days // 7) + 1)
                weekly_impr = grp.groupby("week_dt")["impressions"].sum().sort_index()
                local_peak = float(weekly_impr.max()) if not weekly_impr.empty else 0.0
                local_recent = float(weekly_impr.tail(2).mean()) if not weekly_impr.empty else 0.0
                local_decay = round(local_recent / local_peak, 4) if local_peak > 0.0 else 1.0

                meta = asset_meta.get(aid, {})
                mkey = meta.get("media_hash_key", "")
                focal_brand = meta.get("focal_brand_id") or bid
                theme_lbl = meta.get("theme_label") or "Unclustered"
                gold_match = gold_fatigue_map.get((bid, mkey)) or gold_fatigue_map.get((focal_brand, mkey))

                if gold_match is not None:
                    raw_peak = _finite_float(gold_match.get("peak_weekly_impressions"))
                    raw_recent = _finite_float(gold_match.get("recent_weekly_impressions"))
                    raw_decay = _finite_float(gold_match.get("impression_decay_ratio"))
                    raw_age = _finite_float(gold_match.get("avg_creative_age_weeks"))
                    peak_impr = raw_peak if raw_peak is not None else local_peak
                    recent_impr = raw_recent if raw_recent is not None else local_recent
                    decay_ratio = round(raw_decay, 4) if raw_decay is not None else local_decay
                    is_fatigued = _safe_bool(gold_match.get("is_fatigued", False))
                    age_weeks = round(raw_age) if raw_age is not None else span_weeks
                else:
                    peak_impr = round(local_peak, 2)
                    recent_impr = round(local_recent, 2)
                    decay_ratio = local_decay
                    is_fatigued = bool(span_weeks >= 8 and decay_ratio <= 0.55)
                    age_weeks = span_weeks

                wearout_score = round(max(0.0, min(1.0, 1.0 - decay_ratio)), 3)
                short_id = aid[-8:] if len(aid) > 10 else aid
                fatigue_alerts.append(
                    {
                        "asset_id": aid,
                        "short_asset_id": short_id,
                        "brand_id": bid,
                        "focal_brand_id": focal_brand,
                        "theme_label": theme_lbl,
                        "channel_group": ch,
                        "active_weeks": n_weeks,
                        "span_weeks": age_weeks,
                        "spend_usd": round(float(grp["spend_usd"].sum()), 2),
                        "impressions": int(grp["impressions"].sum()),
                        "peak_weekly_impressions": round(peak_impr, 2),
                        "recent_weekly_impressions": round(recent_impr, 2),
                        "impression_decay_ratio": decay_ratio,
                        "first_week": str(grp["week_dt"].min().date()),
                        "last_week": str(grp["week_dt"].max().date()),
                        "wearout_score": wearout_score,
                        "is_fatigued": is_fatigued,
                    }
                )
            fatigue_alerts.sort(
                key=lambda x: (x["is_fatigued"], x["wearout_score"], x["spend_usd"]),
                reverse=True,
            )
            fatigue_alerts = fatigue_alerts[:15]

    scatter_points: list[dict[str, Any]] = []
    if not dim_themes.empty:
        active_t = dim_themes.copy()
        if "is_active_run" in active_t.columns:
            active_t = active_t[active_t["is_active_run"] == True]  # noqa: E712
        if not assets_df.empty and "media_hash_key" in active_t.columns:
            merged = active_t.merge(
                assets_df[["asset_id", "media_hash_key", "brand_id_raw", "media_type"]].drop_duplicates("media_hash_key"),
                on="media_hash_key",
                how="left",
            )
            if canon_brand:
                merged = merged[merged["brand_id_raw"] == canon_brand]
            scatter_points = _clean_records(merged.head(120))
        else:
            scatter_points = _clean_records(active_t.head(120))

    return {
        "status": "success",
        "country_iso": country_iso,
        "country_name": country_display_name(country_iso),
        "category_hhi": round(hhi, 2),
        "hhi_concentration": "High" if hhi >= 2500 else ("Moderate" if hhi >= 1500 else "Competitive"),
        "themes": themes_out,
        "jaccard_overlaps": jaccard_pairs,
        "scatter_points": scatter_points,
        "fatigue_alerts": fatigue_alerts,
    }


def inspect_creative_evidence(
    asset_id: str | None = None,
    brand_id: str | None = None,
    hook_type: str | None = None,
    only_overridden: bool = False,
    limit: int = 24,
) -> dict[str, Any]:
    """Queries the live DuckDB creative view (`vw_live_creative_dissection`) combining Vision v2 & HITL overrides.

    Args:
        asset_id: Optional exact creative asset identifier.
        brand_id: Optional brand filter (`matched_brand_id` or `evaluated_brand_id`).
        hook_type: Optional hook classification filter (`offer_first`, `product_demo`, etc.).
        only_overridden: If True, returns only creatives with human overrides.
        limit: Maximum creative cards returned (default 24).

    Returns:
        Dict with `items` (each containing `media_endpoint` and live `has_human_override` status) and `audit_summary`.
    """
    lakehouse = get_lakehouse_root()
    con = duckdb.connect(":memory:")
    try:
        themes_path = _resolve_themes_path(lakehouse)
        view_name = register_live_dissection_view(
            con,
            assets_path=lakehouse / "silver" / "dim_creative_asset",
            dissection_path=_resolve_dissection_path(lakehouse),
            overrides_dir=lakehouse / "overrides",
            themes_path=themes_path if themes_path.exists() else None,
        )
        clauses: list[str] = []
        params: list[Any] = []
        exact_aid = ""
        if asset_id:
            exact_aid = asset_id.strip()
            clauses.append("(asset_id = ? OR STARTS_WITH(LOWER(asset_id), LOWER(?)) OR LOWER(asset_id) LIKE LOWER(?))")
            params.extend([exact_aid, exact_aid, f"%{exact_aid}"])
        if brand_id:
            canon = canonicalize_brand_id(brand_id) or brand_id.strip()
            clauses.append(
                "(COALESCE(NULLIF(matched_brand_id, ''), '') = ? OR evaluated_brand_id = ? OR brand_id_raw = ?)"
            )
            params.extend([canon, canon, canon])
        if hook_type:
            clauses.append("LOWER(COALESCE(hook_type, '')) = LOWER(?)")
            params.append(hook_type.strip())
        if only_overridden:
            clauses.append("has_human_override = TRUE")

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        order_prefix = "(asset_id = ?) DESC, " if exact_aid else ""
        order_params = [exact_aid] if exact_aid else []
        df = con.execute(
            f"""
            SELECT *
            FROM {view_name}
            {where_sql}
            ORDER BY {order_prefix}has_human_override DESC, confidence DESC, asset_id ASC
            LIMIT ?
            """,
            [*params, *order_params, max(1, min(int(limit), 200))],
        ).fetchdf()

        summary_row = con.execute(
            f"""
            SELECT
                COUNT(DISTINCT asset_id) AS total_assets,
                COUNT(DISTINCT CASE WHEN belongs_to_brand = TRUE THEN asset_id END) AS verified_assets,
                COUNT(DISTINCT CASE WHEN has_human_override = TRUE THEN asset_id END) AS overridden_assets
            FROM {view_name}
            """
        ).fetchone()
    finally:
        con.close()

    items = _clean_records(df)
    item_mkeys = {
        str(item["media_hash_key"])
        for item in items
        if item.get("media_hash_key") is not None and str(item["media_hash_key"])
    }

    gold_fatigue_path = lakehouse / "gold" / "themes_analytics" / "creative_fatigue"
    fatigue_by_brand_hash: dict[tuple[str, str], dict[str, Any]] = {}
    fatigue_by_hash: dict[str, dict[str, Any]] = {}
    if item_mkeys and gold_fatigue_path.exists():
        fatigue_df = read_parquet_table(gold_fatigue_path, table_name="creative_fatigue")
        if not fatigue_df.empty and "media_hash_key" in fatigue_df.columns:
            fatigue_filtered = fatigue_df[fatigue_df["media_hash_key"].astype(str).isin(item_mkeys)]
            for fdict in fatigue_filtered.to_dict(orient="records"):
                raw_b = fdict.get("brand_id")
                raw_m = fdict.get("media_hash_key")
                bkey = str(raw_b) if raw_b is not None and pd.notna(raw_b) else ""
                mkey = str(raw_m) if raw_m is not None and pd.notna(raw_m) else ""
                if mkey:
                    fatigue_by_brand_hash[(bkey, mkey)] = fdict
                    fatigue_by_hash.setdefault(mkey, fdict)

    theme_scope_map: dict[str, str] = {}
    if item_mkeys and themes_path.exists():
        dim_themes = read_parquet_table(themes_path)
        if not dim_themes.empty and "media_hash_key" in dim_themes.columns and "theme_scope" in dim_themes.columns:
            active_t = (
                dim_themes[dim_themes["is_active_run"] == True]  # noqa: E712
                if "is_active_run" in dim_themes.columns
                else dim_themes
            )
            active_filtered = active_t[active_t["media_hash_key"].astype(str).isin(item_mkeys)]
            for trow in active_filtered.to_dict(orient="records"):
                raw_m = trow.get("media_hash_key")
                tscope = trow.get("theme_scope")
                mkey = str(raw_m) if raw_m is not None and pd.notna(raw_m) else ""
                if mkey and tscope is not None and pd.notna(tscope) and str(tscope):
                    theme_scope_map[mkey] = str(tscope)

    for item in items:
        aid = str(item["asset_id"])
        item["short_asset_id"] = aid[-8:] if len(aid) > 10 else aid
        item["media_endpoint"] = f"/api/v1/media/{aid}"
        mkey = str(item.get("media_hash_key") or "")
        focal_brand = str(
            item.get("matched_brand_id")
            or item.get("evaluated_brand_id")
            or item.get("brand_id_raw")
            or ""
        )
        fmatch = fatigue_by_brand_hash.get((focal_brand, mkey)) or fatigue_by_hash.get(mkey)
        raw_decay = _finite_float(fmatch.get("impression_decay_ratio")) if fmatch else None
        raw_age = _finite_float(fmatch.get("avg_creative_age_weeks")) if fmatch else None
        decay_ratio = round(raw_decay, 4) if raw_decay is not None else None
        item["is_fatigued"] = _safe_bool(fmatch.get("is_fatigued", False)) if fmatch else False
        item["impression_decay_ratio"] = decay_ratio
        item["active_weeks"] = round(raw_age) if raw_age is not None else None
        item["wearout_score"] = (
            round(max(0.0, min(1.0, 1.0 - decay_ratio)), 3) if decay_ratio is not None else None
        )
        item["theme_scope"] = theme_scope_map.get(mkey)

    total_assets = int(summary_row[0] or 0) if summary_row else 0
    verified_assets = int(summary_row[1] or 0) if summary_row else 0
    overridden_assets = int(summary_row[2] or 0) if summary_row else 0
    coverage_pct = round(100.0 * verified_assets / max(1, total_assets), 2)

    return {
        "status": "success",
        "count": len(items),
        "audit_summary": {
            "total_assets": total_assets,
            "verified_assets": verified_assets,
            "overridden_assets": overridden_assets,
            "audit_coverage_pct": coverage_pct,
        },
        "items": items,
    }


def apply_creative_human_override(
    *,
    target_key_type: OverrideTargetType = "asset_id",
    target_key_value: str,
    field_name: OverrideFieldName = "matched_brand_id",
    human_value: str,
    reviewer: str = "analyst",
    reason: str = "",
    ai_value: str | None = None,
) -> dict[str, Any]:
    """Atomically persists a human override (`<50ms`), clears stale caches, and returns the updated live view."""
    t0 = time.perf_counter()
    lakehouse = get_lakehouse_root()
    store = HumanOverrideStore(lakehouse / "overrides")
    record = store.write_override(
        target_key_type=target_key_type,
        target_key_value=target_key_value,
        field_name=field_name,
        human_value=human_value,
        reviewer=reviewer,
        reason=reason,
        ai_value=ai_value,
    )
    REPORT_CACHE.clear()

    asset_filter = target_key_value if target_key_type == "asset_id" else None
    query_limit = 10 if target_key_type == "asset_id" else 50
    live = inspect_creative_evidence(asset_id=asset_filter, limit=query_limit)
    if target_key_type == "asset_id":
        live_items = [i for i in live["items"] if i.get("asset_id") == target_key_value]
    elif target_key_type == "media_hash_key":
        live_items = [i for i in live["items"] if i.get("media_hash_key") == target_key_value]
    elif target_key_type == "theme_label":
        live_items = [
            i
            for i in live["items"]
            if i.get("theme_label") in (target_key_value, human_value)
            or i.get("raw_theme_label") == target_key_value
        ]
    else:
        live_items = live["items"]

    latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    return {
        "status": "success",
        "latency_ms": latency_ms,
        "override": record.model_dump(mode="json"),
        "updated_items": live_items,
        "audit_summary": live["audit_summary"],
    }


def list_available_mmm_scopes() -> list[dict[str, str]]:
    """Lists pre-computed `brand_id_country_iso` MMM artifact scopes available in the lakehouse."""
    lakehouse = get_lakehouse_root()
    mmm_root = lakehouse / "gold" / "mmm_artifacts"
    if not mmm_root.exists():
        return []
    scopes: list[dict[str, str]] = []
    for child in sorted(mmm_root.iterdir()):
        if child.is_dir() and (child / "response_curves.json").exists():
            parts = child.name.rsplit("_", 1)
            if len(parts) == 2:
                scopes.append({"brand_id": parts[0], "country_iso": parts[1], "scope_key": child.name})
    return scopes


def run_mmm_what_if_simulation(
    brand_id: str = "BMW",
    country: str = "Germany",
    total_budget_usd: float | None = None,
    proposed_spend_by_channel: dict[str, float] | None = None,
    optimize: bool = False,
    panel_type: str = "conversions",
) -> dict[str, Any]:
    """Executes pure-Python MMM budget simulation over pre-computed Bayesian response curves.

    Args:
        brand_id: Target brand identifier (default: "BMW").
        country: Target country name or ISO code (default: "Germany").
        total_budget_usd: Optional weekly total budget override in USD.
        proposed_spend_by_channel: Optional per-channel weekly USD spend proposal.
        optimize: If True, computes marginal-utility optimal channel budget split.
        panel_type: Outcome panel mode ("conversions" or "google_trends_proxy").

    Returns:
        Dict with MMM channel 90% HDI ROAS intervals, budget simulation lift, ladder diagnostics,
        theme attribution, and explicit proxy/modeled-spend disclaimer fields.
    """
    lakehouse = get_lakehouse_root()
    canon_brand = canonicalize_brand_id(brand_id)
    country_iso = _safe_country_iso(country)
    scope_dir = lakehouse / "gold" / "mmm_artifacts" / f"{canon_brand}_{country_iso}"

    using_fallback_scope = False
    if not (scope_dir / "response_curves.json").exists():
        scopes = list_available_mmm_scopes()
        if not scopes:
            return {
                "status": "not_found",
                "message": "No pre-computed MMM artifacts found in lakehouse/gold/mmm_artifacts.",
            }
        scope_dir = lakehouse / "gold" / "mmm_artifacts" / scopes[0]["scope_key"]
        using_fallback_scope = True

    requested_proxy = panel_type.lower().strip() in ("google_trends_proxy", "proxy")
    if requested_proxy and (scope_dir / "response_curves_proxy.json").exists():
        curves_path = scope_dir / "response_curves_proxy.json"
        diagnostics_path = (
            scope_dir / "mmm_diagnostics_proxy.json"
            if (scope_dir / "mmm_diagnostics_proxy.json").exists()
            else scope_dir / "mmm_diagnostics.json"
        )
    else:
        curves_path = scope_dir / "response_curves.json"
        diagnostics_path = scope_dir / "mmm_diagnostics.json"

    response_curves = json.loads(curves_path.read_text(encoding="utf-8"))
    diagnostics = (
        json.loads(diagnostics_path.read_text(encoding="utf-8")) if diagnostics_path.exists() else {}
    )

    is_proxy = requested_proxy or bool(response_curves.get("is_proxy_outcome", False))
    if is_proxy:
        response_curves = {
            **response_curves,
            "is_proxy_outcome": True,
            "roas_claim_blocked": True,
            "roi_label": "proxy_index_only",
            "outcome_metric_name": "google_trends_index",
            "disclaimer": (
                "PROXY OUTCOME GUARDRAIL: Calibrated against Search Trends Index rather than verified financial conversions. "
                "Dollar ROAS claims and profit assertions are BLOCKED."
            ),
        }

    effective_proposed = (
        {}
        if (not optimize and proposed_spend_by_channel is None and total_budget_usd is None)
        else proposed_spend_by_channel
    )
    simulation = simulate_budget_reallocation(
        response_curves,
        proposed_spend_by_channel=effective_proposed,
        total_budget_usd=total_budget_usd,
        optimize=optimize,
    )

    return {
        "status": "success",
        "requested_scope": {"brand_id": canon_brand, "country_iso": country_iso},
        "artifact_scope": {
            "brand_id": response_curves.get("brand_id"),
            "country_iso": response_curves.get("country_iso"),
            "used_fallback_scope": using_fallback_scope,
        },
        "panel_type": "google_trends_proxy" if is_proxy else "conversions",
        "is_proxy_outcome": is_proxy,
        "is_spend_modeled": bool(response_curves.get("is_spend_modeled", False)),
        "roas_claim_blocked": bool(response_curves.get("roas_claim_blocked", is_proxy)),
        "roi_label": response_curves.get("roi_label", "incremental_roas"),
        "disclaimer": response_curves.get("disclaimer", ""),
        "channels": response_curves.get("channels", {}),
        "theme_attribution": response_curves.get("theme_attribution", []),
        "ladder_comparison": diagnostics.get("ladder_comparison", []),
        "simulation": simulation,
        "available_scopes": list_available_mmm_scopes(),
    }


def _resolve_channel_brand_id(channel_title: Any) -> str | None:
    """Maps a YouTube channel title to its canonical brand_id if matched."""
    raw = str(channel_title or "").strip()
    if not raw:
        return None
    canon = canonicalize_brand_id(raw)
    if canon:
        return canon
    lower = raw.lower()
    if re.search(r"\bbmw\b", lower):
        return "BMW"
    if re.search(r"\b(mercedes|mercedes-benz|amg)\b", lower):
        return "Mercedes-Benz"
    if re.search(r"\baudi\b", lower):
        return "Audi"
    if re.search(r"\bporsche\b", lower):
        return "Porsche"
    return None


def get_velocity_breakout_alerts_and_ops(
    top_k: int = 12,
    brand_id: str | None = None,
) -> dict[str, Any]:
    """Returns Velocity breakout predictions, PSI drift diagnostics, FinOps spend summary, and Vision Eval gates.

    Args:
        top_k: Maximum number of breakout queue items returned (default 12).
        brand_id: Optional canonical brand identifier filter (e.g. "BMW", "Mercedes-Benz").

    Returns:
        Dict with `breakout_queue`, `drift_report`, `finops_summary`, and `vision_eval_status`.
    """
    vel_dir = get_velocity_gold_dir()
    scores_path = vel_dir / "velocity_scores.parquet"
    drift_path = vel_dir / "drift_report.json"

    scores_df = read_parquet_table(scores_path) if scores_path.exists() else pd.DataFrame()
    drift_report: dict[str, Any] = (
        json.loads(drift_path.read_text(encoding="utf-8")) if drift_path.exists() else {}
    )

    breakout_items: list[dict[str, Any]] = []
    if not scores_df.empty:
        scores_df = scores_df.copy()
        resolved_brands = (
            scores_df["channel_title"].map(_resolve_channel_brand_id)
            if "channel_title" in scores_df.columns
            else pd.Series([None] * len(scores_df), index=scores_df.index)
        )
        if "brand_id" in scores_df.columns:
            existing_canon = scores_df["brand_id"].map(
                lambda val: (canonicalize_brand_id(str(val)) or str(val).strip())
                if val is not None and pd.notna(val) and str(val).strip()
                else None
            )
            scores_df["brand_id"] = existing_canon.where(existing_canon.notna(), resolved_brands)
        elif "channel_title" in scores_df.columns:
            scores_df["brand_id"] = resolved_brands
        if brand_id and brand_id.strip():
            target_brand = canonicalize_brand_id(brand_id) or brand_id.strip()
            if "brand_id" in scores_df.columns:
                scores_df = scores_df[scores_df["brand_id"] == target_brand]
            else:
                scores_df = scores_df.iloc[0:0]
        if not scores_df.empty:
            sorted_df = scores_df.sort_values("breakout_prob", ascending=False).head(max(1, min(int(top_k), 100)))
            breakout_items = _clean_records(sorted_df)

    ledger_candidates = [
        Path(configs.INTEL_LAKEHOUSE_DIR) / "costs_ledger.csv",
        Path(configs.INTEL_LAKEHOUSE_DIR).parent / "costs_ledger.csv",
        Path("costs_ledger.csv"),
    ]
    ledger_path = next((p for p in ledger_candidates if p.exists()), ledger_candidates[0])
    finops = summarize_ledger(ledger_path)
    finops["total_estimated_cost_usd"] = finops.get("total_cost_usd", 0.0)

    eval_cases = load_golden_manifest(DEFAULT_GOLDEN_MANIFEST_PATH) if DEFAULT_GOLDEN_MANIFEST_PATH.exists() else []
    eval_summary = {
        "benchmark_name": "Golden Vision Eval v1",
        "total_cases": len(eval_cases),
        "positive_cases": sum(1 for c in eval_cases if c.expected_belongs_to_brand),
        "negative_trap_cases": sum(1 for c in eval_cases if not c.expected_belongs_to_brand),
        "gates": {"min_brand_f1": 0.85, "max_fpr": 0.15, "min_hook_accuracy": 0.80},
        "manifest_present": DEFAULT_GOLDEN_MANIFEST_PATH.exists(),
    }

    return {
        "status": "success",
        "velocity_source_dir": str(vel_dir),
        "total_scored_videos": len(scores_df),
        "predicted_breakouts": int(scores_df["is_predicted_breakout"].sum()) if "is_predicted_breakout" in scores_df.columns else 0,
        "breakout_queue": breakout_items,
        "drift_report": drift_report,
        "finops_summary": finops,
        "vision_eval": eval_summary,
    }


def get_portal_overview() -> dict[str, Any]:
    """Assembles unified executive KPIs across Lakehouse Gold, MMM, Velocity, and HITL audit coverage."""
    sos_de = query_federated_sos_sov(country="Germany")
    themes_de = get_creative_themes_and_fatigue(country="Germany")
    ops = get_velocity_breakout_alerts_and_ops(top_k=5)
    mmm = run_mmm_what_if_simulation(brand_id="BMW", country="Germany", optimize=False)

    return {
        "status": "success",
        "market_highlight": {
            "country_iso": "DE",
            "country_name": "Germany",
            "total_spend_usd": sos_de.get("total_spend_usd", 0.0),
            "total_impressions": sos_de.get("total_impressions", 0),
            "audit_coverage_pct": sos_de.get("audit_coverage_pct", 0.0),
            "brands": sos_de.get("brands", []),
        },
        "theme_summary": {
            "category_hhi": themes_de.get("category_hhi", 0.0),
            "hhi_concentration": themes_de.get("hhi_concentration", "Unknown"),
            "theme_count": len(themes_de.get("themes", [])),
            "fatigued_creative_count": sum(1 for a in themes_de.get("fatigue_alerts", []) if a.get("is_fatigued")),
        },
        "mmm_highlight": {
            "brand_id": mmm.get("artifact_scope", {}).get("brand_id"),
            "country_iso": mmm.get("artifact_scope", {}).get("country_iso"),
            "champion_tier": "tier3_bayesian_pymc_nutpie",
            "ladder_comparison": mmm.get("ladder_comparison", []),
            "is_proxy_outcome": mmm.get("is_proxy_outcome", False),
        },
        "velocity_highlight": {
            "total_scored_videos": ops.get("total_scored_videos", 0),
            "predicted_breakouts": ops.get("predicted_breakouts", 0),
            "drift_status": ops.get("drift_report", {}).get("overall_status", "unknown"),
            "mean_psi": ops.get("drift_report", {}).get("mean_psi", 0.0),
            "finops_spend_usd": ops.get("finops_summary", {}).get("total_estimated_cost_usd", 0.0),
            "golden_eval_cases": ops.get("vision_eval", {}).get("total_cases", 0),
        },
    }


def resolve_creative_media_bytes(asset_id: str) -> tuple[bytes, str]:
    """Resolves media bytes safely from lakehouse storage or renders a deterministic SVG/PNG preview card."""
    lakehouse = get_lakehouse_root()
    assets_df = read_parquet_table(lakehouse / "silver" / "dim_creative_asset", table_name="dim_creative_asset")
    if assets_df.empty or "asset_id" not in assets_df.columns:
        raise FileNotFoundError(f"Asset {asset_id!r} not found in lakehouse.")

    match = assets_df[assets_df["asset_id"] == asset_id]
    if match.empty:
        raise FileNotFoundError(f"Asset {asset_id!r} not found in lakehouse.")

    row = match.iloc[0]
    media_uri = str(row.get("media_uri") or "")
    local_candidate: Path | None = None
    if media_uri.startswith("file://"):
        local_candidate = Path(media_uri[7:])
    elif "://" not in media_uri and media_uri:
        p = Path(media_uri)
        local_candidate = p if p.is_absolute() else (lakehouse / p)

    # Strict path traversal quarantine inside configured lakehouse or staged media root
    if local_candidate is not None and local_candidate.exists() and local_candidate.is_file():
        resolved = local_candidate.resolve()
        allowed_roots = [lakehouse.resolve(), Path.cwd().resolve()]
        if any(resolved.is_relative_to(root) for root in allowed_roots):
            ext = resolved.suffix.lower()
            mime = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".webp": "image/webp",
                ".mp4": "video/mp4",
            }.get(ext, "application/octet-stream")
            return resolved.read_bytes(), mime

    # Synthetic CDN / un-downloaded creative fallback: render clean informative PNG preview card
    brand = str(row.get("brand_id_raw") or "Unknown")
    mtype = str(row.get("media_type") or "image").upper()
    ar = str(row.get("aspect_ratio") or "4:5")
    source = str(row.get("source_connector") or "synthetic")
    palette = {
        "BMW": (22, 88, 168),
        "Mercedes-Benz": (46, 56, 72),
        "Audi": (153, 27, 45),
        "Porsche": (132, 98, 28),
    }.get(brand, (51, 65, 85))

    w, h = (480, 270) if ar == "16:9" else ((360, 450) if ar == "4:5" else ((320, 568) if ar == "9:16" else (400, 400)))
    img = Image.new("RGB", (w, h), color=palette)
    draw = ImageDraw.Draw(img)
    draw.rectangle([14, 14, w - 14, h - 14], outline=(226, 232, 240), width=2)
    lines = [
        f"BRAND: {brand}",
        f"TYPE: {mtype}  |  RATIO: {ar}",
        f"SOURCE: {source}",
        f"ASSET: {asset_id[:16]}...",
        f"PHASH: {row.get('phash') or 'n/a'}",
    ]
    y_cursor = 36
    for idx, line in enumerate(lines):
        draw.text((28, y_cursor + idx * 28), line, fill=(248, 250, 252))
    buf = BytesIO()
    img.save(buf, format="PNG")
    # Also ensure non-empty math sanity in bytes
    if not math.isfinite(float(w)):
        raise RuntimeError("Invalid image dimensions")
    return buf.getvalue(), "image/png"
