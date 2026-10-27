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
"""Synthetic Multi-Market Ad Intelligence Dataset Generator & Demo Report Builder.

Generates a realistic multi-country, multi-industry digital advertising dataset
matching the exact BigQuery schema produced by `query_template.sql`, allowing
developers and portfolio reviewers to run the full Brand Analytics Agent locally
(`DATA_BACKEND=local`) without needing access to an enterprise BigQuery table.

Usage:
    uv run python scripts/generate_synthetic_ad_data.py
    uv run python scripts/generate_synthetic_ad_data.py --build-sample-reports
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import json
import os
import random
import sys
from pathlib import Path

import pandas as pd

# Ensure project root is importable
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


# ---------------------------------------------------------------------------
# Brand & Market Catalog
# ---------------------------------------------------------------------------
BRAND_CATALOG = {
    "Automotive": {
        "BMW": {
            "advertiser_name": "BMW AG",
            "domains": {"Germany": "bmw.de", "United Kingdom": "bmw.co.uk", "United States": "bmwusa.com", "Singapore": "bmw.com.sg", "Vietnam": "bmw.vn"},
            "keywords": ["bmw", "bayerische motoren werke"],
            "campaigns": ["BMW i4 Electric Performance", "BMW X5 xDrive Luxury SUV", "BMW Neue Klasse Vision", "BMW M3 Touring Launch"],
            "base_spend": 18500.0,
            "cpm_range": (11.5, 18.0),
        },
        "Mercedes-Benz": {
            "advertiser_name": "Mercedes-Benz AG",
            "domains": {"Germany": "mercedes-benz.de", "United Kingdom": "mercedes-benz.co.uk", "United States": "mbusa.com", "Singapore": "mercedes-benz.com.sg", "Vietnam": "mercedes-benz.com.vn"},
            "keywords": ["mercedes", "mercedes-benz", "mercedesbenz"],
            "campaigns": ["EQE SUV Electric Intelligence", "C-Class Sedan Elegance", "G-Class All-Electric Launch", "AMG GT Coupé Performance"],
            "base_spend": 22000.0,
            "cpm_range": (12.0, 19.5),
        },
        "Audi": {
            "advertiser_name": "AUDI AG",
            "domains": {"Germany": "audi.de", "United Kingdom": "audi.co.uk", "United States": "audiusa.com", "Singapore": "audi.com.sg", "Vietnam": "audi.vn"},
            "keywords": ["audi", "vorsprung durch technik"],
            "campaigns": ["Audi Q6 e-tron Quattro", "Audi A6 Avant e-tron", "Audi RS e-tron GT Performance"],
            "base_spend": 14000.0,
            "cpm_range": (10.5, 16.5),
        },
        "Porsche": {
            "advertiser_name": "Dr. Ing. h.c. F. Porsche AG",
            "domains": {"Germany": "porsche.de", "United Kingdom": "porsche.co.uk", "United States": "porsche.com", "Singapore": "porsche.com", "Vietnam": "porsche-vietnam.vn"},
            "keywords": ["porsche", "porsche taycan"],
            "campaigns": ["Porsche Macan Electric", "Porsche 911 Carrera Hybrid", "Porsche Taycan Turbo GT"],
            "base_spend": 11500.0,
            "cpm_range": (14.0, 22.0),
        },
    },
    "Luxury & Beauty": {
        "Dior": {
            "advertiser_name": "Christian Dior Couture",
            "domains": {"Germany": "dior.com", "United Kingdom": "dior.com", "United States": "dior.com", "Singapore": "dior.com", "Vietnam": "dior.com"},
            "keywords": ["dior", "christian dior", "dior.com"],
            "campaigns": ["Dior Autumn-Winter Couture", "Miss Dior Parfum Launch", "Lady Dior Iconic Handbag", "Dior Sauvage Elixir"],
            "base_spend": 16000.0,
            "cpm_range": (13.0, 21.0),
        },
        "Chanel": {
            "advertiser_name": "CHANEL SAS",
            "domains": {"Germany": "chanel.com", "United Kingdom": "chanel.com", "United States": "chanel.com", "Singapore": "chanel.com", "Vietnam": "chanel.com"},
            "keywords": ["chanel", "chanel.com", "coco chanel"],
            "campaigns": ["Chanel N°5 L'Eau Campaign", "Chanel Cruise Collection", "Bleu de Chanel Eau de Parfum", "Chanel Haute Joaillerie"],
            "base_spend": 19500.0,
            "cpm_range": (14.5, 23.0),
        },
        "Hermes": {
            "advertiser_name": "Hermès International",
            "domains": {"Germany": "hermes.com", "United Kingdom": "hermes.com", "United States": "hermes.com", "Singapore": "hermes.com", "Vietnam": "hermes.com"},
            "keywords": ["hermes", "hermes.com"],
            "campaigns": ["Hermès Silk Scarf Stories", "Terre d'Hermès Eau Givree", "Hermès Equestrian Craftsmanship"],
            "base_spend": 9800.0,
            "cpm_range": (16.0, 25.0),
        },
    },
    "Confectionery & FMCG": {
        "Haribo": {
            "advertiser_name": "HARIBO GmbH & Co. KG",
            "domains": {"Germany": "haribo.com", "United Kingdom": "haribo.com", "United States": "haribo.com", "Singapore": "haribo.com", "Vietnam": "haribo.com"},
            "keywords": ["haribo", "haribo.com", "haribo goldbaeren"],
            "campaigns": ["Haribo Goldbären Family Fun", "Haribo Tropifrutti Summer", "Haribo Phantasia Party Mix"],
            "base_spend": 8500.0,
            "cpm_range": (6.5, 11.0),
        },
        "Katjes": {
            "advertiser_name": "Katjes Fassin GmbH + Co. KG",
            "domains": {"Germany": "katjes.de", "United Kingdom": "katjes.com", "United States": "katjes.us", "Singapore": "katjes.com", "Vietnam": "katjes.com"},
            "keywords": ["katjes", "katjes.de", "katjes wunderland"],
            "campaigns": ["Katjes Wunderland 100% Veggie", "Katjes Chocjes Oat Chocolate", "Katjes Grün-Ohr Hase"],
            "base_spend": 5200.0,
            "cpm_range": (6.0, 10.5),
        },
    },
}

CHANNELS_AND_PUBLISHERS = [
    ("Social", "Meta", ["Instagram", "Facebook"], "Social", "image/png", ".png"),
    ("Social", "TikTok", ["TikTok"], "Social", "video/mp4", ".mp4"),
    ("Social", "X", ["X"], "Social", "image/jpeg", ".jpg"),
    ("Social", "LinkedIn", ["LinkedIn"], "Social", "image/png", ".png"),
    ("Video", "YouTube", ["YouTube"], "Video", "video/mp4", ".mp4"),
    ("Video", "Other Video", ["Twitch", "Dailymotion", "Vimeo"], "Video", "video/mp4", ".mp4"),
    ("Display", "Other Display", ["Der Spiegel", "The Guardian", "New York Times", "Vogue", "GQ", "AutoBild", "Straits Times", "VnExpress"], "Display", "image/png", ".png"),
]

TARGET_MARKETS = ["Germany", "United Kingdom", "United States", "Singapore", "Vietnam"]
MARKET_SCALE = {
    "United States": 1.45,
    "Germany": 1.00,
    "United Kingdom": 0.95,
    "Singapore": 0.45,
    "Vietnam": 0.35,
}

MONTHS_2025_2026 = [
    "2025-01-01", "2025-02-01", "2025-03-01", "2025-04-01", "2025-05-01", "2025-06-01",
    "2025-07-01", "2025-08-01", "2025-09-01", "2025-10-01", "2025-11-01", "2025-12-01",
    "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01",
]


def generate_synthetic_dataset(seed: int = 42) -> pd.DataFrame:
    """Generates a deterministic, high-realism multi-market ad intelligence dataset."""
    rng = random.Random(seed)
    rows: list[dict] = []

    for month_str in MONTHS_2025_2026:
        month_num = int(month_str.split("-")[1])
        # Seasonal multiplier (Q4 holiday peak, Q1 launch bump)
        seasonal_mult = 1.35 if month_num in (11, 12) else (1.15 if month_num in (3, 9) else 1.0)

        for market in TARGET_MARKETS:
            m_scale = MARKET_SCALE[market]
            market_code = market[:2].lower()

            for industry, brands in BRAND_CATALOG.items():
                for brand_name, b_info in brands.items():
                    domain = b_info["domains"].get(market, f"{brand_name.lower()}.com")
                    localized_handle = f"{brand_name.lower().replace('-', '')}_{market_code}"
                    matched_kws = sorted(set(b_info["keywords"] + [domain, localized_handle]))
                    matched_kws_str = ", ".join(matched_kws)

                    for ch_idx, (ch_group, pub_group, pub_list, ch_name, mime, ext) in enumerate(CHANNELS_AND_PUBLISHERS):
                        # Select 1-2 publishers per channel group per month
                        selected_pubs = rng.sample(pub_list, k=min(len(pub_list), rng.randint(1, 2)))
                        for pub in selected_pubs:
                            for camp_idx, campaign in enumerate(b_info["campaigns"]):
                                if rng.random() < 0.35:
                                    continue  # Realistic sparsity across campaigns/publishers

                                ch_weight = 0.42 if ch_group == "Social" else (0.35 if ch_group == "Video" else 0.23)
                                noise = rng.uniform(0.65, 1.45)
                                spend = round(
                                    (b_info["base_spend"] / len(b_info["campaigns"]))
                                    * m_scale
                                    * seasonal_mult
                                    * ch_weight
                                    * noise,
                                    2,
                                )
                                cpm = rng.uniform(*b_info["cpm_range"])
                                impressions = max(1000, int((spend / cpm) * 1000))

                                slug = f"{brand_name.lower().replace('-', '_')}_{camp_idx}_{ch_idx}"
                                creative_id = f"cr_{slug}_{market_code}"
                                creative_url = f"https://creative-assets.{domain}/ads/{slug}{ext}"

                                rows.append(
                                    {
                                        "month": month_str,
                                        "occurrence_collectiondate": month_str,
                                        "country": market.upper(),
                                        "advertiser_name": b_info["advertiser_name"],
                                        "advertiser_domain": domain,
                                        "channel_name": ch_name,
                                        "channel_group": ch_group,
                                        "publisher_name": pub,
                                        "publisher_group": pub_group,
                                        "creative_campaign_name": campaign,
                                        "creative_landingpage_url": f"https://www.{domain}/{slug}",
                                        "creative_url_supplier": creative_url,
                                        "creative_id": creative_id,
                                        "creative_inventory_type": "Mobile" if ch_group == "Social" else "Desktop & Mobile",
                                        "creative_mime_type": mime,
                                        "transaction_method": "Programmatic" if ch_group == "Display" else "Direct",
                                        "occurrence_user_device": rng.choice(["Mobile", "Desktop", "Tablet"]),
                                        "occurrence_user_app_type": "In-App" if ch_group == "Social" else "Web",
                                        "matched_keywords": matched_kws_str,
                                        "spend": spend,
                                        "impressions": impressions,
                                    }
                                )

                # Inject co-mention / comparative ad rows for Automotive (tests 50/50 split attribution)
                if industry == "Automotive":
                    rows.append(
                        {
                            "month": month_str,
                            "occurrence_collectiondate": month_str,
                            "country": market.upper(),
                            "advertiser_name": "Auto Comparative Portal",
                            "advertiser_domain": f"auto-compare.{market_code}",
                            "channel_name": "Display",
                            "channel_group": "Display",
                            "publisher_name": "AutoBild" if market == "Germany" else "The Guardian",
                            "publisher_group": "Other Display",
                            "creative_campaign_name": "Compare BMW vs Mercedes-Benz EV Range",
                            "creative_landingpage_url": f"https://auto-compare.{market_code}/bmw-vs-mercedes",
                            "creative_url_supplier": f"https://auto-compare.{market_code}/banners/bmw_merc_compare.png",
                            "creative_id": f"cr_comp_bmw_merc_{market_code}_{month_str[:7]}",
                            "creative_inventory_type": "Desktop",
                            "creative_mime_type": "image/png",
                            "transaction_method": "Programmatic",
                            "occurrence_user_device": "Desktop",
                            "occurrence_user_app_type": "Web",
                            "matched_keywords": "bmw, mercedes",
                            "spend": round(1200.0 * m_scale, 2),
                            "impressions": int(65000 * m_scale),
                        }
                    )

                # Inject third-party counterfeit/reseller ad for Luxury (tests multimodal verification filtering)
                if industry == "Luxury & Beauty":
                    rows.append(
                        {
                            "month": month_str,
                            "occurrence_collectiondate": month_str,
                            "country": market.upper(),
                            "advertiser_name": "Discount Perfume Outlet",
                            "advertiser_domain": "cheap-perfumes-online.com",
                            "channel_name": "Display",
                            "channel_group": "Display",
                            "publisher_name": "Glamour",
                            "publisher_group": "Other Display",
                            "creative_campaign_name": "Dior & Chanel Clearance Outlet",
                            "creative_landingpage_url": "https://cheap-perfumes-online.com/dior",
                            "creative_url_supplier": "https://cheap-perfumes-online.com/ads/dior_fake_banner.png",
                            "creative_id": f"cr_fake_dior_{market_code}_{month_str[:7]}",
                            "creative_inventory_type": "Mobile",
                            "creative_mime_type": "image/png",
                            "transaction_method": "Programmatic",
                            "occurrence_user_device": "Mobile",
                            "occurrence_user_app_type": "Web",
                            "matched_keywords": "dior",
                            "spend": round(950.0 * m_scale, 2),
                            "impressions": int(45000 * m_scale),
                        }
                    )

    return pd.DataFrame(rows)


async def build_sample_reports() -> list[Path]:
    """Runs the local query, metrics, feasibility, and HTML report generators to produce showcase artifacts."""
    os.environ["DATA_BACKEND"] = "local"
    os.environ["INTEGRATION_TEST"] = "TRUE"

    from brand_analytics_app.tools import (
        calculate_report_metrics,
        check_brand_feasibility,
        execute_bq_query,
        generate_feasibility_report_html,
        verify_creatives_multimodal,
    )

    samples_dir = PROJECT_ROOT / "examples" / "sample_reports"
    samples_dir.mkdir(parents=True, exist_ok=True)
    generated_files: list[Path] = []

    # 1. Query synthetic dataset for Germany Q1 2026 (BMW, Mercedes-Benz, Audi, Porsche)
    brand_keywords_map = {
        "BMW": ["bmw", "bmw.de"],
        "Mercedes-Benz": ["mercedes", "mercedes-benz", "mercedes-benz.de"],
        "Audi": ["audi", "audi.de"],
        "Porsche": ["porsche", "porsche.de"],
    }
    brand_domains_map = {
        "BMW": ["bmw.de", "bmw.com"],
        "Mercedes-Benz": ["mercedes-benz.de", "mercedes-benz.com"],
        "Audi": ["audi.de", "audi.com"],
        "Porsche": ["porsche.de", "porsche.com"],
    }
    flat_kws = [kw for kws in brand_keywords_map.values() for kw in kws]

    data_parquet = PROJECT_ROOT / "data" / "synthetic_ad_occurrences.parquet"
    df_all = pd.read_parquet(data_parquet)
    df_q1_de = df_all[
        (df_all["country"] == "GERMANY")
        & (df_all["month"] >= "2026-01-01")
        & (df_all["month"] <= "2026-03-31")
    ].to_dict(orient="records")

    # 2. Compute Comprehensive Report Metrics & Pre-rendered Plotly Charts
    rep_metrics = calculate_report_metrics(
        bq_data=df_q1_de,
        brand_keywords_map=brand_keywords_map,
        report_type="comprehensive",
    )
    charts = rep_metrics.get("chart_html", {})
    totals = rep_metrics.get("brand_totals", {})

    # Build a clean showcase Comprehensive Competitive HTML Dashboard
    brand_rows_html = ""
    for b_name, b_stats in totals.items():
        if b_name == "Total":
            continue
        pubs = rep_metrics.get("publisher_counts", {}).get(b_name, 0)
        creatives = rep_metrics.get("unique_creatives", {}).get(b_name, 0)
        brand_rows_html += f"""
        <tr>
            <td><strong>{b_name}</strong></td>
            <td>${b_stats['spend']:,.2f}</td>
            <td>{b_stats['share_of_spend']:.2f}%</td>
            <td>{b_stats['impressions']:,}</td>
            <td>{b_stats['share_of_impressions']:.2f}%</td>
            <td>{pubs}</td>
            <td>{creatives}</td>
        </tr>"""

    tot_stats = totals.get("Total", {"spend": 0, "impressions": 0})
    comprehensive_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Comprehensive Competitive Report — Germany (Q1 2026)</title>
    <script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>
    <style>
        body {{ font-family: 'Segoe UI', Inter, system-ui, sans-serif; background: #f4f6f9; color: #1f2937; margin: 0; padding: 32px; }}
        .container {{ max-width: 1200px; margin: 0 auto; background: #fff; padding: 36px; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }}
        h1 {{ color: #111827; margin-top: 0; font-size: 28px; }}
        .subtitle {{ color: #6b7280; margin-bottom: 28px; font-size: 15px; }}
        .insight-card {{ background: #f8f9fa; border-left: 4px solid #1a73e8; padding: 20px; margin-bottom: 28px; border-radius: 0 8px 8px 0; }}
        table {{ width: 100%; border-collapse: collapse; margin-bottom: 28px; font-size: 14px; }}
        th, td {{ padding: 12px 16px; text-align: left; border-bottom: 1px solid #e5e7eb; }}
        th {{ background: #f9fafb; font-weight: 600; color: #374151; text-transform: uppercase; font-size: 12px; }}
        .grid-2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }}
        .chart-card {{ border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #fff; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Comprehensive Competitive Report — Germany</h1>
        <div class="subtitle">Target Period: 2026-01-01 to 2026-03-31 | Industry: Automotive | Data Backend: Synthetic Demo Dataset</div>
        <div class="insight-card">
            <strong>Key Insights</strong>
            <ul>
                <li><strong>Mercedes-Benz</strong> leads overall market investment and Share of Voice across Q1 2026, driven by its EQE SUV and C-Class campaigns.</li>
                <li><strong>BMW</strong> maintains a strong second position with balanced multi-channel distribution across Social, Video, and Display.</li>
                <li><strong>Audi</strong> and <strong>Porsche</strong> concentrate spend in high-impact Video and Social placements aimed at premium EV buyers.</li>
            </ul>
        </div>
        <h2>Master Brand Performance Overview</h2>
        <table>
            <thead>
                <tr>
                    <th>Brand</th><th>Spend ($)</th><th>SOS (%)</th><th>Impressions</th><th>SOV (%)</th><th># Publishers</th><th>Unique Creatives</th>
                </tr>
            </thead>
            <tbody>
                {brand_rows_html}
                <tr style="background:#f9fafb;font-weight:bold;">
                    <td>Category Total</td>
                    <td>${tot_stats['spend']:,.2f}</td>
                    <td>100.00%</td>
                    <td>{tot_stats['impressions']:,}</td>
                    <td>100.00%</td>
                    <td>-</td>
                    <td>-</td>
                </tr>
            </tbody>
        </table>
        <h2>Monthly Spend & Impressions Trends</h2>
        <div class="grid-2">
            <div class="chart-card">{charts.get('spend_trend', '')}</div>
            <div class="chart-card">{charts.get('impressions_trend', '')}</div>
        </div>
        <div class="grid-2">
            <div class="chart-card">{charts.get('sos_trend', '')}</div>
            <div class="chart-card">{charts.get('sov_trend', '')}</div>
        </div>
        <h2>Channel Group & Publisher Mix</h2>
        <div class="grid-2">
            <div class="chart-card">{charts.get('channel_spend_mix', '')}</div>
            <div class="chart-card">{charts.get('publisher_count_bar', '')}</div>
        </div>
    </div>
</body>
</html>"""

    comp_path = samples_dir / "comprehensive_competitive_report_germany_q1_2026.html"
    comp_path.write_text(comprehensive_html, encoding="utf-8")
    generated_files.append(comp_path)

    # 3. Generate Sample Feasibility & Creative Verification HTML Report
    ver_res = await verify_creatives_multimodal(
        bq_data=df_q1_de,
        brand_keywords_map=brand_keywords_map,
        brand_domains_map=brand_domains_map,
        start_date="2026-01-01",
        end_date="2026-03-31",
    )
    feas_res = check_brand_feasibility(
        bq_data=df_q1_de,
        brand_keywords_map=brand_keywords_map,
        start_date="2026-01-01",
        end_date="2026-03-31",
        creative_verifications=ver_res,
    )
    from brand_analytics_app.tools.data_loader import _resolve_creative_verifications

    ver_list = _resolve_creative_verifications(ver_res)
    feas_html = generate_feasibility_report_html(
        country="Germany",
        feasibility_data=feas_res,
        creative_verifications=ver_list,
        start_date="2026-01-01",
        end_date="2026-03-31",
        target_category="Automotive",
    )
    feas_path = samples_dir / "feasibility_verification_report_germany_q1_2026.html"
    feas_path.write_text(feas_html, encoding="utf-8")
    generated_files.append(feas_path)

    return generated_files


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic multi-market ad occurrences dataset.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility.")
    parser.add_argument(
        "--output",
        type=str,
        default=str(PROJECT_ROOT / "data" / "synthetic_ad_occurrences.parquet"),
        help="Output Parquet path.",
    )
    parser.add_argument(
        "--build-sample-reports",
        action="store_true",
        help="Also generate sample interactive HTML reports in examples/sample_reports/.",
    )
    args = parser.parse_args()

    df = generate_synthetic_dataset(seed=args.seed)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)

    print(f"[+] Generated {len(df):,} synthetic ad occurrence rows across {df['country'].nunique()} markets.")
    print(f"[+] Saved Parquet dataset to: {out_path}")

    if args.build_sample_reports:
        reports = asyncio.run(build_sample_reports())
        for r in reports:
            print(f"[+] Generated sample interactive HTML report: {r}")


if __name__ == "__main__":
    main()
