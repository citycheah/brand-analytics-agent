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
"""HTML generation and export for campaign feasibility reports."""
from collections import defaultdict
from typing import Any

from brand_analytics_app.tools.data_loader import _resolve_creative_verifications


def generate_feasibility_report_html(
    country: str,
    feasibility_data: dict,
    creative_verifications: list[dict],
    start_date: str,
    end_date: str,
    target_category: str | None = None,
) -> str:
    """Generates the Feasibility and Creative Verification HTML report deterministically."""

    # Format currency and numbers
    def fmt_curr(val):
        return f"${val:,.0f}" if isinstance(val, (int, float)) else str(val)

    def fmt_num(val):
        return f"{val:,.0f}" if isinstance(val, (int, float)) else str(val)

    brands_checked = (
        len([b for b in feasibility_data.values() if isinstance(b, dict)])
        if feasibility_data
        else 0
    )
    total_spend = (
        sum(
            b.get("spend", 0)
            for b in feasibility_data.values()
            if isinstance(b, dict)
        )
        if feasibility_data
        else 0
    )
    total_impr = (
        sum(
            b.get("impressions", 0)
            for b in feasibility_data.values()
            if isinstance(b, dict)
        )
        if feasibility_data
        else 0
    )

    # Build Feasibility Rows
    feasibility_rows = ""
    for brand, data in feasibility_data.items():
        if not isinstance(data, dict):
            continue
        is_feasible = data.get("is_feasible", False)
        badge_class = (
            "bg-green-100 text-green-800"
            if is_feasible
            else "bg-red-100 text-red-800"
        )
        badge_text = "Feasible" if is_feasible else "Not Feasible"

        spend = fmt_curr(data.get("spend", 0))
        impr = fmt_num(data.get("impressions", 0))
        spend_th = fmt_curr(data.get("spend_threshold", 0))
        impr_th = fmt_num(
            data.get("impressions_threshold") or data.get("impr_threshold", 0)
        )

        feasibility_rows += f"""
        <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{brand}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{spend}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{impr}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{spend_th}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{impr_th}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full {badge_class}">{badge_text}</span>
            </td>
        </tr>
        """

    # Build Creative Sections per Brand
    brand_creatives_groups = defaultdict(list)
    for c in creative_verifications:
        brand = c.get("matched_brand") or "Unknown"
        brand_creatives_groups[brand].append(c)

    brand_sections_html = ""
    for brand, c_list in brand_creatives_groups.items():
        rows_html = ""
        for c in c_list:
            cat = c.get("category", "Other")
            product = c.get("product", "N/A")
            spend = fmt_curr(c.get("spend", 0))
            impr = fmt_num(c.get("impressions", 0))
            exp = c.get("explanation", "")
            url = c.get("url", "#")

            is_target_cat = target_category and cat.lower() == target_category.lower()
            badge_class = (
                "bg-blue-100 text-blue-800"
                if is_target_cat
                else "bg-gray-100 text-gray-800"
            )
            badge_text = cat

            rows_html += f"""
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 text-sm font-medium text-blue-600">
                    <a href="{url}" target="_blank" class="hover:underline">View Creative</a>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{brand}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full {badge_class}">{badge_text}</span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-500">{product}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{spend}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{impr}</td>
                <td class="px-6 py-4 text-sm text-gray-500 max-w-xs truncate" title="{exp}">{exp}</td>
            </tr>
            """
        count_label = f"({len(c_list)} Creative{'s' if len(c_list) != 1 else ''})"
        brand_sections_html += f"""
        <div class="card overflow-x-auto mb-6">
            <h3 class="text-lg font-semibold text-gray-800 mb-3">{brand} <span class="text-sm font-normal text-gray-500">{count_label}</span></h3>
            <table class="verified-creatives-table min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Creative</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Brand</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Spend</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Impressions</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reasoning</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                    {rows_html}
                </tbody>
            </table>
        </div>
        """

    if not brand_sections_html:
        brand_sections_html = """<div class="card p-6 text-center text-sm text-gray-500">No verified creatives found.</div>"""

    target_cat_str = f"| Target Category: {target_category}" if target_category else ""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Feasibility & Creative Verification - {country}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; }}
        .card {{ background: white; border-radius: 0.5rem; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1); margin-bottom: 2rem; padding: 1.5rem; }}
    </style>
</head>
<body class="p-8">
    <div class="max-w-7xl mx-auto">
        <header class="mb-8">
            <h1 class="text-3xl font-bold text-gray-900">Feasibility & Creative Verification</h1>
            <p class="text-gray-500 mt-2">{country} | {start_date} to {end_date} {target_cat_str}</p>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
                <h3 class="text-sm font-medium text-gray-500">Brands Analyzed</h3>
                <p class="text-2xl font-semibold text-gray-900 mt-2">{brands_checked}</p>
            </div>
            <div class="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
                <h3 class="text-sm font-medium text-gray-500">Total Verified Spend</h3>
                <p class="text-2xl font-semibold text-gray-900 mt-2">{fmt_curr(total_spend)}</p>
            </div>
            <div class="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
                <h3 class="text-sm font-medium text-gray-500">Total Verified Impressions</h3>
                <p class="text-2xl font-semibold text-gray-900 mt-2">{fmt_num(total_impr)}</p>
            </div>
        </div>

        <div class="card overflow-x-auto">
            <h2 class="text-xl font-semibold text-gray-800 mb-4">Brand Feasibility Summary</h2>
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Brand</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Verified Spend</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Verified Impressions</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Spend Threshold</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Impr Threshold</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                    {feasibility_rows}
                </tbody>
            </table>
        </div>

        <div class="mb-8">
            <div class="flex items-center justify-between mb-4">
                <div>
                    <h2 class="text-xl font-semibold text-gray-800">Top Verified Creatives</h2>
                    <p class="text-sm text-gray-500 mt-1">Top 100 creatives per brand verified as belonging to the target brand, prioritized by matching category and impressions.</p>
                </div>
                <button onclick="downloadCreativesCSV()" class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 cursor-pointer">
                    Export to CSV
                </button>
            </div>
            {brand_sections_html}
        </div>
    </div>
    <script>
        function downloadCreativesCSV() {{
            const tables = document.querySelectorAll(".verified-creatives-table");
            if (!tables.length) return;
            const allRows = [];
            tables.forEach((table, idx) => {{
                const rows = Array.from(table.querySelectorAll("tr"));
                const rowsToExport = idx === 0 ? rows : rows.slice(1);
                allRows.push(...rowsToExport);
            }});
            const csvContent = allRows.map(row => {{
                const cols = Array.from(row.querySelectorAll("th, td"));
                return cols.map(col => {{
                    const link = col.querySelector("a");
                    let text = link ? link.href : col.innerText.trim();
                    text = text.replace(/"/g, '""');
                    return `"${{text}}"`;
                }}).join(",");
            }}).join("\\r\\n");

            const blob = new Blob([csvContent], {{ type: "text/csv;charset=utf-8;" }});
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `verified_creatives_{country.lower().replace(' ', '_')}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }}
    </script>
</body>
</html>"""
    return html


async def export_feasibility_report(
    country: str,
    feasibility_data: dict,
    creative_verifications: list[dict] | dict | str | None,
    start_date: str,
    end_date: str,
    target_category: str | None = None,
    tool_context: Any = None,
) -> dict:
    """Extracts country data, processes creatives, and generates/exports the feasibility report."""

    # 1. Extract Target Country Feasibility Data
    country_feasibility = {}
    if feasibility_data:
        # Check if flat (brand keys are at root)
        if any(
            isinstance(v, dict) and "is_feasible" in v
            for v in feasibility_data.values()
        ):
            country_feasibility = {
                k: v
                for k, v in feasibility_data.items()
                if k != "status" and isinstance(v, dict)
            }
        else:
            # Nested: { "Germany": { "BrandA": ... }, "France": ... }
            for k, v in feasibility_data.items():
                if k.lower() == country.lower() and isinstance(v, dict):
                    country_feasibility = {
                        bk: bv
                        for bk, bv in v.items()
                        if bk != "status" and isinstance(bv, dict)
                    }
                    break

    # 2. Process Creative Verifications
    processed_creatives = []
    if creative_verifications:
        raw_verifications = _resolve_creative_verifications(creative_verifications)

        # Filter for country and valid brand ownership
        matched_creatives = [
            v
            for v in raw_verifications
            if str(v.get("country", "")).lower() == country.lower()
            and v.get("belongs_to_brand", True)
        ]

        # Sort by target category, then by impressions
        def get_sort_key(c):
            cat_match = 0
            if (
                target_category
                and c.get("category", "").lower() == target_category.lower()
            ):
                cat_match = 1
            impr = c.get("impressions", 0) or 0
            return (cat_match, impr)

        # Group by brand and take top 100 per brand
        brand_creatives_map = defaultdict(list)
        for c in matched_creatives:
            b = c.get("matched_brand") or "Unknown"
            brand_creatives_map[b].append(c)

        processed_creatives = []
        brand_order = list(country_feasibility.keys())
        for b in brand_order:
            if b in brand_creatives_map:
                brand_creatives_map[b].sort(key=get_sort_key, reverse=True)
                processed_creatives.extend(brand_creatives_map[b][:100])
        for b, c_list in brand_creatives_map.items():
            if b not in brand_order:
                c_list.sort(key=get_sort_key, reverse=True)
                processed_creatives.extend(c_list[:100])

    # 3. Generate HTML
    html_content = generate_feasibility_report_html(
        country=country,
        feasibility_data=country_feasibility,
        creative_verifications=processed_creatives,
        start_date=start_date,
        end_date=end_date,
        target_category=target_category,
    )

    # 4. Export Artifact
    import brand_analytics_app.tools

    res = await brand_analytics_app.tools.export_report(
        html_content=html_content,
        country=country,
        report_type="feasibility",
        start_date=start_date,
        end_date=end_date,
        tool_context=tool_context,
    )

    return {
        "status": "success",
        "html_file_uri": res.get("html_file_uri", ""),
        "summary": f"Feasibility and Creative Verification report for {country} generated successfully.",
    }
