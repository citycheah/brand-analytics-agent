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
"""Detailed report metrics and chart calculations."""
import uuid

import pandas as pd
import plotly.graph_objects as go

from brand_analytics_app.tools.cache import REPORT_CACHE
from brand_analytics_app.tools.metrics import (
    _attribute_data_to_brands,
    _calculate_brand_totals,
)
from brand_analytics_app.tools.utils import normalize_brand_keywords_map


def _calculate_monthly_trends(
    country_df: pd.DataFrame, brands_map: dict
) -> tuple[dict, dict, int, dict]:
    """Calculates monthly trends, shares and pre-renders line & stacked bar charts.

    Returns:
        tuple containing (monthly_trends, monthly_shares, num_months, chart_html)
    """
    monthly_trends = {}
    monthly_shares = {}
    chart_html = {}
    num_months = 0

    if country_df.empty:
        return monthly_trends, monthly_shares, num_months, chart_html

    def format_spend_label(val):
        if val <= 0:
            return "$0"
        if val >= 1000:
            return f"${val / 1000:.1f}k".replace(".0k", "k")
        return f"${val:.2f}"

    def format_impr_label(val):
        if val <= 0:
            return "0"
        if val >= 1_000_000:
            return f"{val / 1_000_000:.1f}M".replace(".0M", "M")
        if val >= 1000:
            return f"{val / 1000:.1f}k".replace(".0k", "k")
        return str(int(val))

    country_df["month_dt"] = pd.to_datetime(country_df["month"])
    unique_months_all = sorted(country_df["month_dt"].dt.strftime("%Y-%m-%d").unique())
    num_months = len(unique_months_all)

    trend_months = unique_months_all[-12:] if num_months > 12 else unique_months_all
    trend_months_dt = [pd.Timestamp(m) for m in trend_months]
    x_labels = [dt.strftime("%b %Y") for dt in trend_months_dt]

    trend_df = country_df[
        country_df["month_dt"].dt.strftime("%Y-%m-%d").isin(trend_months)
    ]
    if not trend_df.empty:
        pivot_df = trend_df.pivot_table(
            index="month_dt",
            columns="brand",
            values=["spend", "impressions"],
            aggfunc="sum",
        ).fillna(0.0)

        for col in ["spend", "impressions"]:
            for b in brands_map:
                if (col, b) not in pivot_df.columns:
                    pivot_df[(col, b)] = 0.0

        pivot_df = pivot_df.reindex(trend_months_dt, fill_value=0.0)

        for brand in brands_map:
            monthly_trends[brand] = []
            monthly_shares[brand] = []
            for m_dt in trend_months_dt:
                m_str = m_dt.strftime("%Y-%m-%d")
                b_spend = float(pivot_df.loc[m_dt, ("spend", brand)])
                b_impr = int(pivot_df.loc[m_dt, ("impressions", brand)])

                m_total_spend = sum(
                    pivot_df.loc[m_dt, ("spend", b)] for b in brands_map
                )
                m_total_impr = sum(
                    pivot_df.loc[m_dt, ("impressions", b)] for b in brands_map
                )

                b_sos = (b_spend / m_total_spend) * 100.0 if m_total_spend > 0 else 0.0
                b_sov = (b_impr / m_total_impr) * 100.0 if m_total_impr > 0 else 0.0

                monthly_trends[brand].append(
                    {"month": m_str, "spend": round(b_spend, 2), "impressions": b_impr}
                )
                monthly_shares[brand].append(
                    {"month": m_str, "sos": round(b_sos, 2), "sov": round(b_sov, 2)}
                )

        if num_months >= 2:
            fig_spend = go.Figure()
            for brand in brands_map:
                y_vals = [
                    float(pivot_df.loc[m_dt, ("spend", brand)])
                    for m_dt in trend_months_dt
                ]
                txt_lbls = [format_spend_label(y) for y in y_vals]
                fig_spend.add_trace(
                    go.Scatter(
                        x=x_labels,
                        y=y_vals,
                        mode="lines+markers+text",
                        name=brand,
                        text=txt_lbls,
                        textposition="top center",
                        textfont={"size": 9},
                    )
                )
            fig_spend.update_layout(
                title="Monthly Spend Trend (USD)",
                xaxis={"title": "Month", "tickangle": 0},
                yaxis={"title": "Spend", "tickprefix": "$"},
                template="plotly_white",
                margin={"l": 40, "r": 40, "t": 50, "b": 40},
            )
            chart_html["spend_trend"] = fig_spend.to_html(
                full_html=False, include_plotlyjs=False
            )

            fig_impr = go.Figure()
            for brand in brands_map:
                y_vals = [
                    float(pivot_df.loc[m_dt, ("impressions", brand)])
                    for m_dt in trend_months_dt
                ]
                y_vals_m = [y / 1_000_000 for y in y_vals]
                txt_lbls = [format_impr_label(y) for y in y_vals]
                fig_impr.add_trace(
                    go.Scatter(
                        x=x_labels,
                        y=y_vals_m,
                        mode="lines+markers+text",
                        name=brand,
                        text=txt_lbls,
                        textposition="top center",
                        textfont={"size": 9},
                    )
                )
            fig_impr.update_layout(
                title="Monthly Impressions Trend (Millions)",
                xaxis={"title": "Month", "tickangle": 0},
                yaxis={"title": "Impressions (Millions)"},
                template="plotly_white",
                margin={"l": 40, "r": 40, "t": 50, "b": 40},
            )
            chart_html["impressions_trend"] = fig_impr.to_html(
                full_html=False, include_plotlyjs=False
            )

            fig_sos = go.Figure()
            for brand in brands_map:
                shares = []
                txt_lbls = []
                for m_dt in trend_months_dt:
                    m_total_spend = sum(
                        pivot_df.loc[m_dt, ("spend", b)] for b in brands_map
                    )
                    b_spend = pivot_df.loc[m_dt, ("spend", brand)]
                    sh = (b_spend / m_total_spend) * 100.0 if m_total_spend > 0 else 0.0
                    shares.append(sh)
                    txt_lbls.append(f"<b>{sh:.1f}%</b>" if sh > 6 else "")
                fig_sos.add_trace(
                    go.Bar(
                        x=x_labels,
                        y=shares,
                        name=brand,
                        text=txt_lbls,
                        textposition="inside",
                        textfont={"color": "white", "size": 9},
                    )
                )
            fig_sos.update_layout(
                barmode="stack",
                title="Share of Spend (SOS) Trend (%)",
                xaxis={"title": "Month"},
                yaxis={"title": "Share (%)", "range": [0, 100]},
                template="plotly_white",
                margin={"l": 40, "r": 40, "t": 50, "b": 40},
            )
            chart_html["sos_trend"] = fig_sos.to_html(
                full_html=False, include_plotlyjs=False
            )

            fig_sov = go.Figure()
            for brand in brands_map:
                shares = []
                txt_lbls = []
                for m_dt in trend_months_dt:
                    m_total_impr = sum(
                        pivot_df.loc[m_dt, ("impressions", b)] for b in brands_map
                    )
                    b_impr = pivot_df.loc[m_dt, ("impressions", brand)]
                    sh = (b_impr / m_total_impr) * 100.0 if m_total_impr > 0 else 0.0
                    shares.append(sh)
                    txt_lbls.append(f"<b>{sh:.1f}%</b>" if sh > 6 else "")
                fig_sov.add_trace(
                    go.Bar(
                        x=x_labels,
                        y=shares,
                        name=brand,
                        text=txt_lbls,
                        textposition="inside",
                        textfont={"color": "white", "size": 9},
                    )
                )
            fig_sov.update_layout(
                barmode="stack",
                title="Share of Voice (SOV) Trend (%)",
                xaxis={"title": "Month"},
                yaxis={"title": "Share (%)", "range": [0, 100]},
                template="plotly_white",
                margin={"l": 40, "r": 40, "t": 50, "b": 40},
            )
            chart_html["sov_trend"] = fig_sov.to_html(
                full_html=False, include_plotlyjs=False
            )

    return monthly_trends, monthly_shares, num_months, chart_html


def _calculate_channel_breakdowns(
    country_df: pd.DataFrame, brands_map: dict
) -> tuple[dict, dict]:
    """Calculates channel group breakdowns and pre-renders spend and impression mix charts.

    Returns:
        tuple containing (channel_breakdown, chart_html)
    """
    channel_breakdown = {}
    chart_html = {}
    valid_channels = ["Social", "Video", "Display"]

    if country_df.empty:
        return channel_breakdown, chart_html

    ch_col = (
        "channel_group"
        if "channel_group" in country_df.columns
        else (
            "channel_clean" if "channel_clean" in country_df.columns else "channel_name"
        )
    )

    country_df["channel_mapped"] = country_df[ch_col].apply(
        lambda x: (
            str(x).capitalize().strip()
            if str(x).capitalize().strip() in valid_channels
            else "Display"
        )
    )

    for brand in brands_map:
        channel_breakdown[brand] = {}
        for ch in valid_channels:
            channel_breakdown[brand][ch] = {"spend": 0.0, "impressions": 0, "cpm": 0.0}

    ch_gb = (
        country_df.groupby(["brand", "channel_mapped"])[["spend", "impressions"]]
        .sum()
        .reset_index()
    )
    for _, r in ch_gb.iterrows():
        br = r["brand"]
        ch = r["channel_mapped"]
        sp = float(r["spend"])
        im = int(r["impressions"])
        cpm = (sp / im) * 1000.0 if im > 0 else 0.0
        channel_breakdown[br][ch] = {
            "spend": round(sp, 2),
            "impressions": im,
            "cpm": round(cpm, 2),
        }

    # Spend Mix stack chart
    fig_ch_sp = go.Figure()
    for ch in valid_channels:
        shares = []
        txt_lbls = []
        for brand in brands_map:
            brand_tot = sum(
                channel_breakdown[brand][c]["spend"] for c in valid_channels
            )
            val = channel_breakdown[brand][ch]["spend"]
            sh = (val / brand_tot) * 100.0 if brand_tot > 0 else 0.0
            shares.append(sh)
            txt_lbls.append(f"<b>{sh:.1f}%</b>" if sh > 6 else "")
        fig_ch_sp.add_trace(
            go.Bar(
                y=list(brands_map.keys()),
                x=shares,
                name=ch,
                orientation="h",
                text=txt_lbls,
                textposition="inside",
                textfont={"color": "white", "size": 9},
            )
        )
    fig_ch_sp.update_layout(
        barmode="stack",
        title="Media Spend Mix by Channel Group (%)",
        xaxis={"title": "Share (%)", "range": [0, 100]},
        yaxis={"title": "Brand"},
        template="plotly_white",
        margin={"l": 80, "r": 40, "t": 50, "b": 40},
    )
    chart_html["channel_spend_mix"] = fig_ch_sp.to_html(
        full_html=False, include_plotlyjs=False
    )

    # Impressions Mix stack chart
    fig_ch_im = go.Figure()
    for ch in valid_channels:
        shares = []
        txt_lbls = []
        for brand in brands_map:
            brand_tot = sum(
                channel_breakdown[brand][c]["impressions"] for c in valid_channels
            )
            val = channel_breakdown[brand][ch]["impressions"]
            sh = (val / brand_tot) * 100.0 if brand_tot > 0 else 0.0
            shares.append(sh)
            txt_lbls.append(f"<b>{sh:.1f}%</b>" if sh > 6 else "")
        fig_ch_im.add_trace(
            go.Bar(
                y=list(brands_map.keys()),
                x=shares,
                name=ch,
                orientation="h",
                text=txt_lbls,
                textposition="inside",
                textfont={"color": "white", "size": 9},
            )
        )
    fig_ch_im.update_layout(
        barmode="stack",
        title="Impressions Mix by Channel Group (%)",
        xaxis={"title": "Share (%)", "range": [0, 100]},
        yaxis={"title": "Brand"},
        template="plotly_white",
        margin={"l": 80, "r": 40, "t": 50, "b": 40},
    )
    chart_html["channel_impressions_mix"] = fig_ch_im.to_html(
        full_html=False, include_plotlyjs=False
    )

    return channel_breakdown, chart_html


def _calculate_publisher_data(
    country_df: pd.DataFrame, brands_map: dict, matrix_cap: int
) -> tuple[dict, list, list, dict]:
    """Calculates publisher footprints and pre-renders active publisher counts and matrix tables.

    Returns:
        tuple containing (publisher_counts, publisher_matrix_spend, publisher_matrix_impressions, chart_html)
    """
    publisher_counts = {}
    publisher_matrix_spend = []
    publisher_matrix_impressions = []
    chart_html = {}

    if country_df.empty:
        return (
            publisher_counts,
            publisher_matrix_spend,
            publisher_matrix_impressions,
            chart_html,
        )

    pub_col = (
        "publisher_name"
        if "publisher_name" in country_df.columns
        else (
            "publisher_name_cleaned"
            if "publisher_name_cleaned" in country_df.columns
            else "publisher_group"
        )
    )

    for brand in brands_map:
        brand_df = country_df[country_df["brand"] == brand]
        active_pubs = set(brand_df[pub_col].dropna().unique())
        publisher_counts[brand] = len(active_pubs)

    sorted_brand_counts = sorted(
        publisher_counts.items(),
        key=lambda x: x[1],
        reverse=False,
    )
    y_brands_pub = [item[0] for item in sorted_brand_counts]
    x_counts_pub = [item[1] for item in sorted_brand_counts]

    fig_pub_cnt = go.Figure()
    fig_pub_cnt.add_trace(
        go.Bar(
            y=y_brands_pub,
            x=x_counts_pub,
            orientation="h",
            text=[f"{count} Pubs" for count in x_counts_pub],
            textposition="inside",
            insidetextanchor="end",
            textfont={"color": "white", "size": 10},
            marker={"color": "#1a73e8"},
        )
    )
    fig_pub_cnt.update_layout(
        title="Total Active Publishers Count by Brand",
        xaxis={"title": "Active Publisher Count"},
        yaxis={"title": "Brand"},
        template="plotly_white",
        margin={"l": 80, "r": 40, "t": 50, "b": 40},
    )
    chart_html["publisher_count_bar"] = fig_pub_cnt.to_html(
        full_html=False, include_plotlyjs=False
    )

    pub_totals = country_df.groupby(pub_col)["spend"].sum().reset_index()
    top_pubs = (
        pub_totals.sort_values(by="spend", ascending=False)
        .head(matrix_cap)[pub_col]
        .tolist()
    )

    pub_df = country_df[country_df[pub_col].isin(top_pubs)]
    if not pub_df.empty:
        spend_pivot = pub_df.pivot_table(
            index=pub_col, columns="brand", values="spend", aggfunc="sum"
        ).fillna(0.0)

        impr_pivot = pub_df.pivot_table(
            index=pub_col, columns="brand", values="impressions", aggfunc="sum"
        ).fillna(0.0)

        for b in brands_map:
            if b not in spend_pivot.columns:
                spend_pivot[b] = 0.0
            if b not in impr_pivot.columns:
                impr_pivot[b] = 0.0

        for pub in top_pubs:
            spend_row = {"Publisher Name": pub}
            impr_row = {"Publisher Name": pub}
            for b in brands_map:
                spend_row[b] = round(float(spend_pivot.loc[pub, b]), 2)
                impr_row[b] = int(impr_pivot.loc[pub, b])
            publisher_matrix_spend.append(spend_row)
            publisher_matrix_impressions.append(impr_row)

    return (
        publisher_counts,
        publisher_matrix_spend,
        publisher_matrix_impressions,
        chart_html,
    )


def _calculate_creative_data(
    country_df: pd.DataFrame, brands_map: dict
) -> tuple[dict, dict, dict]:
    """Calculates unique creative asset counts, creative channel group mixes, and pre-renders mix charts.

    Returns:
        tuple containing (unique_creatives, creative_channel_mix, chart_html)
    """
    unique_creatives = {}
    creative_channel_mix = {}
    chart_html = {}

    if country_df.empty:
        return unique_creatives, creative_channel_mix, chart_html

    for brand in brands_map:
        brand_df = country_df[country_df["brand"] == brand]
        creatives_set = set(brand_df["creative_id"].dropna().unique())
        unique_creatives[brand] = len(creatives_set)

    valid_channels = ["Social", "Video", "Display"]
    ch_col = (
        "channel_group"
        if "channel_group" in country_df.columns
        else (
            "channel_clean" if "channel_clean" in country_df.columns else "channel_name"
        )
    )

    country_df["channel_mapped"] = country_df[ch_col].apply(
        lambda x: (
            str(x).capitalize().strip()
            if str(x).capitalize().strip() in valid_channels
            else "Display"
        )
    )

    for brand in brands_map:
        creative_channel_mix[brand] = {}
        brand_df = country_df[country_df["brand"] == brand]
        for ch in valid_channels:
            ch_df = brand_df[brand_df["channel_mapped"] == ch]
            ch_creatives = set(ch_df["creative_id"].dropna().unique())
            creative_channel_mix[brand][ch] = len(ch_creatives)

    fig_ch_cr = go.Figure()
    for ch in valid_channels:
        shares = []
        txt_lbls = []
        for brand in brands_map:
            brand_tot = sum(creative_channel_mix[brand][c] for c in valid_channels)
            val = creative_channel_mix[brand][ch]
            sh = (val / brand_tot) * 100.0 if brand_tot > 0 else 0.0
            shares.append(sh)
            txt_lbls.append(f"<b>{sh:.1f}%</b>" if sh > 6 else "")
        fig_ch_cr.add_trace(
            go.Bar(
                y=list(brands_map.keys()),
                x=shares,
                name=ch,
                orientation="h",
                text=txt_lbls,
                textposition="inside",
                textfont={"color": "white", "size": 9},
            )
        )
    fig_ch_cr.update_layout(
        barmode="stack",
        title="Unique Creative Mix by Channel Group (%)",
        xaxis={"title": "Share (%)", "range": [0, 100]},
        yaxis={"title": "Brand"},
        template="plotly_white",
        margin={"l": 80, "r": 40, "t": 50, "b": 40},
    )
    chart_html["channel_creative_mix"] = fig_ch_cr.to_html(
        full_html=False, include_plotlyjs=False
    )

    return unique_creatives, creative_channel_mix, chart_html


def calculate_report_metrics(
    bq_data: dict | list[dict],
    brand_keywords_map: dict,
    report_type: str,
) -> dict:
    """Computes all detailed metrics and pre-renders Plotly charts for a specific report type.

    Args:
        bq_data: Raw BigQuery records (metadata dict with GCS Parquet path).
        brand_keywords_map: Dict mapping Brand -> List of keywords, or nested dict country -> Brand -> List of keywords.
        report_type: The report type identifier (e.g., 'trends_sos_sov', 'channel_group', 'publisher', 'feasibility', 'comprehensive', 'dynamic').

    Returns:
        Dictionary containing structured metrics and pre-rendered chart HTML snippets.
    """
    import brand_analytics_app.tools

    df = brand_analytics_app.tools._load_query_results(bq_data)
    if not brand_keywords_map:
        return {}

    brand_keywords_map, was_flat = normalize_brand_keywords_map(brand_keywords_map, df)
    is_nested = not was_flat

    results = {}

    rep_type = report_type.lower()
    if "trends" in rep_type or "sov" in rep_type or "sos" in rep_type:
        type_key = "trends_sos_sov"
    elif "channel" in rep_type:
        type_key = "channel_group"
    elif "publisher" in rep_type:
        type_key = "publisher"
    elif "dynamic" in rep_type:
        type_key = "dynamic"
    else:
        type_key = "comprehensive"

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

        # 1. Attribute raw data to brands
        country_df = _attribute_data_to_brands(df_country, brands_map)

        # 2. Brand overall totals
        brand_totals = _calculate_brand_totals(country_df, brands_map)

        # 3. Decomposed execution based on report type
        monthly_trends = {}
        monthly_shares = {}
        channel_breakdown = {}
        publisher_counts = {}
        publisher_matrix_spend = []
        publisher_matrix_impressions = []
        unique_creatives = {}
        creative_channel_mix = {}
        num_months = 0
        chart_html = {}

        # Trends
        if type_key in ("trends_sos_sov", "comprehensive", "dynamic"):
            t_trends, t_shares, n_months, t_charts = _calculate_monthly_trends(
                country_df, brands_map
            )
            monthly_trends = t_trends
            monthly_shares = t_shares
            num_months = n_months
            chart_html.update(t_charts)

        # Channels
        if type_key in ("channel_group", "comprehensive", "dynamic"):
            ch_breakdown, ch_charts = _calculate_channel_breakdowns(
                country_df, brands_map
            )
            channel_breakdown = ch_breakdown
            chart_html.update(ch_charts)

        # Publishers
        if type_key in ("publisher", "comprehensive", "dynamic"):
            matrix_cap = 5 if type_key in ("comprehensive", "dynamic") else 10
            pub_counts, pub_m_spend, pub_m_impr, pub_charts = _calculate_publisher_data(
                country_df, brands_map, matrix_cap
            )
            publisher_counts = pub_counts
            publisher_matrix_spend = pub_m_spend
            publisher_matrix_impressions = pub_m_impr
            chart_html.update(pub_charts)

        # Creatives
        if type_key in ("comprehensive", "dynamic"):
            u_creatives, cr_ch_mix, cr_charts = _calculate_creative_data(
                country_df, brands_map
            )
            unique_creatives = u_creatives
            creative_channel_mix = cr_ch_mix
            chart_html.update(cr_charts)

        results[country] = {
            "brand_totals": brand_totals,
            "monthly_trends": monthly_trends,
            "monthly_shares": monthly_shares,
            "channel_breakdown": channel_breakdown,
            "publisher_counts": publisher_counts,
            "publisher_matrix_spend": publisher_matrix_spend,
            "publisher_matrix_impressions": publisher_matrix_impressions,
            "unique_creatives": unique_creatives,
            "creative_channel_mix": creative_channel_mix,
            "num_months": num_months,
            "chart_html": chart_html,
        }

    results["status"] = "success"
    cache_id = str(uuid.uuid4())
    results["report_cache_id"] = cache_id
    REPORT_CACHE[cache_id] = results

    if not is_nested:
        country_keys = [
            k for k in results.keys() if k not in ("status", "report_cache_id")
        ]
        if len(country_keys) == 1:
            flat_res = results[country_keys[0]].copy()
            flat_res["report_cache_id"] = cache_id
            flat_res["status"] = "success"
            return flat_res

    return results
