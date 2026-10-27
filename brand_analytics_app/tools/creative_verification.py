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
"""Multimodal creative verification tool using Gemini Vision."""
import asyncio
import json

try:
    import google.auth
    from google.genai import types
except ImportError:
    google = None  # type: ignore[assignment]
    types = None  # type: ignore[assignment]

from brand_analytics_app import configs
from brand_analytics_app.tools.data_loader import (
    _persist_and_summarize_verifications,
)
from brand_analytics_app.tools.feasibility import get_feasibility_defaults
from brand_analytics_app.tools.utils import (
    calculate_scale_factor,
    logger,
)


def _norm_domain(d: str) -> str:
    """Standardizes domain by lowercasing and stripping leading www."""
    s = (d or "").strip().lower()
    return s[4:] if s.startswith("www.") else s


async def verify_creatives_multimodal(
    bq_data: dict | list[dict],
    brand_keywords_map: dict,
    brand_domains_map: dict,
    target_category: str | None = None,
    spend_threshold: float | None = None,
    impressions_threshold: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Evaluates creative ad alignment for multiple brands and countries concurrently with early stopping,
    conditional domain-level filtering, batching, and native GCS URI processing.
    """
    import brand_analytics_app.tools

    batch_size = configs.VERIFY_CREATIVES_BATCH_SIZE
    concurrency_limit = configs.VERIFY_CREATIVES_CONCURRENCY_LIMIT
    df = brand_analytics_app.tools._load_query_results(bq_data)
    if df.empty:
        return _persist_and_summarize_verifications(
            [], bq_data, target_category=target_category
        )

    # Detect if brand_keywords_map is nested
    if not brand_keywords_map:
        return _persist_and_summarize_verifications(
            [], bq_data, target_category=target_category
        )
    first_val = next(iter(brand_keywords_map.values()))
    is_nested = isinstance(first_val, dict)

    if not is_nested:
        unique_countries = ["Unknown"]
        if not df.empty:
            country_col = (
                "country"
                if "country" in df.columns
                else ("country_name" if "country_name" in df.columns else None)
            )
            if country_col:
                unique_countries = [c for c in df[country_col].dropna().unique() if c]
        if not unique_countries:
            unique_countries = ["Unknown"]
        brand_keywords_map = dict.fromkeys(unique_countries, brand_keywords_map)
        brand_domains_map = dict.fromkeys(unique_countries, brand_domains_map)

    # Mock execution for offline validation (pytest / integration tests)
    if configs.INTEGRATION_TEST:
        results = []
        if "creative_url_supplier" in df.columns:
            creative_metadata_list = (
                df.groupby("creative_url_supplier", as_index=False)
                .first()
                .to_dict(orient="records")
            )
        else:
            creative_metadata_list = df.to_dict(orient="records")
        for c in creative_metadata_list:
            url = c.get("creative_url_supplier", "")
            is_valid = "dior_fake" not in url and "cheap-perfumes" not in url
            category = "Fashion" if "fashion" in url or "dior" in url else "Automotive"
            matched_brand = (
                "BMW"
                if "bmw" in url
                else ("Mercedes" if "mercedes" in url or "merc" in url else "Dior")
            )
            results.append(
                {
                    "url": url,
                    "country": c.get("country", "Unknown"),
                    "belongs_to_brand": is_valid,
                    "matched_brand": matched_brand if is_valid else None,
                    "target_brand": matched_brand or "Brand",
                    "product": "Mock Product",
                    "category": category,
                    "spend": float(c.get("spend", 0.0)),
                    "impressions": int(c.get("impressions", 0)),
                    "explanation": "Mocked validation result.",
                }
            )
        return _persist_and_summarize_verifications(
            results, bq_data, target_category=target_category
        )

    scale_factor = calculate_scale_factor(start_date, end_date)
    if spend_threshold is not None:
        spend_threshold = spend_threshold * scale_factor
    if impressions_threshold is not None:
        impressions_threshold = int(impressions_threshold * scale_factor)

    # Configure Domain Pre-filtering behavior
    # Enabled only if target_category is NOT provided
    use_domain_filtering = not bool(target_category and target_category.strip())

    if not use_domain_filtering:
        logger.info(
            "Category evaluation requested. Bypassing Domain Filtering to ensure unbiased classification."
        )

    # Initialize early stopping accumulators
    brand_accumulators = {}
    for country_key, brands_map in brand_keywords_map.items():
        for brand in brands_map:
            brand_accumulators[(country_key, brand)] = {"spend": 0.0, "impressions": 0}

    def has_brand_met_thresholds(country_name: str, brand_name: str) -> bool:
        base_spend, base_impressions = get_feasibility_defaults(country_name)

        spend_t = spend_threshold
        if spend_t is None:
            spend_t = base_spend * scale_factor

        impressions_t = impressions_threshold
        if impressions_t is None:
            impressions_t = int(base_impressions * scale_factor)

        acc = brand_accumulators.get((country_name, brand_name))
        if not acc:
            return False
        return (acc["spend"] >= spend_t) or (acc["impressions"] >= impressions_t)

    def find_brands_by_domain(country_name: str, domain: str, brand_name: str) -> bool:
        if not domain:
            return False
        norm_dom = _norm_domain(domain)
        domains = brand_domains_map.get(country_name, {}).get(brand_name, [])
        for d in domains:
            d_clean = _norm_domain(d)
            if d_clean == norm_dom or norm_dom.endswith("." + d_clean):
                return True
        return False

    # Map BigQuery rows to brand(s) per country
    brand_rows = {}
    for country_key, brands_map in brand_keywords_map.items():
        for brand in brands_map:
            brand_rows[(country_key, brand)] = []

    bq_records = df.to_dict(orient="records")
    for row in bq_records:
        row_country = row.get("country", "")
        if not row_country:
            matched_country = next(iter(brand_keywords_map.keys()))
        else:
            matched_country = None
            for c in brand_keywords_map.keys():
                if c.lower() == row_country.lower():
                    matched_country = c
                    break
        if not matched_country:
            continue

        matched_str = row.get("matched_keywords", "")
        if not matched_str:
            continue

        kw_matches = [k.lower().strip() for k in matched_str.split(",") if k.strip()]

        # Reverse keyword map specifically for this country
        keyword_to_brand = {}
        for brand, keywords in brand_keywords_map[matched_country].items():
            for kw in keywords:
                keyword_to_brand[kw.lower().strip()] = brand

        matched_brands = {
            keyword_to_brand[kw] for kw in kw_matches if kw in keyword_to_brand
        }
        for brand in matched_brands:
            brand_rows[(matched_country, brand)].append(row)

    # Group by creative_url_supplier for each (country, brand)
    brand_creatives = {}
    brand_total_potential = {}
    max_creatives = configs.MAX_CREATIVE_VERIFICATIONS_PER_BRAND
    for (country_key, brand), rows in brand_rows.items():
        creative_groups = {}
        for r in rows:
            url = r.get("creative_url_supplier")
            if not url:
                continue
            if url not in creative_groups:
                creative_groups[url] = {
                    "creative_url_supplier": url,
                    "spend": 0.0,
                    "impressions": 0,
                    "advertiser_domain": r.get("advertiser_domain", ""),
                    "advertiser_name": r.get("advertiser_name", ""),
                    "creative_campaign_name": r.get("creative_campaign_name", ""),
                    "matched_keywords": r.get("matched_keywords", ""),
                    "country": country_key,
                }
            creative_groups[url]["spend"] += float(r.get("spend", 0.0))
            creative_groups[url]["impressions"] += int(r.get("impressions", 0))

        sorted_creatives = sorted(
            creative_groups.values(), key=lambda x: x["impressions"], reverse=True
        )
        total_brand_spend = sum(c["spend"] for c in sorted_creatives)
        total_brand_impressions = sum(c["impressions"] for c in sorted_creatives)
        has_more_creatives = len(sorted_creatives) > max_creatives

        brand_total_potential[(country_key, brand)] = {
            "spend": total_brand_spend,
            "impressions": total_brand_impressions,
            "has_more": has_more_creatives,
        }

        brand_creatives[(country_key, brand)] = sorted_creatives[:max_creatives]

    # Global caches/results
    gemini_cache = {}  # url -> result_dict
    project_id = configs.GOOGLE_CLOUD_PROJECT
    if not project_id and configs.DATA_BACKEND == "bigquery" and google is not None:
        try:
            _, project_id = google.auth.default()
        except Exception:
            pass
    project_id = project_id or "local-demo-project"

    use_vertex = str(configs.GOOGLE_GENAI_USE_VERTEXAI).lower() not in ("false", "0")
    if use_vertex:
        client = brand_analytics_app.tools.Client(
            vertexai=True,
            project=project_id,
            location=configs.GOOGLE_CLOUD_LOCATION,
        )
    else:
        client = brand_analytics_app.tools.Client(vertexai=False)
    sem = asyncio.Semaphore(concurrency_limit)

    async def process_batch_chunk(
        chunk: list[dict], target_brand: str, country_name: str
    ) -> list[dict]:
        async with sem:
            media_parts = []
            creative_refs = []

            for idx, c in enumerate(chunk):
                url = c["creative_url_supplier"]

                mime_type = "image/png"
                if url.endswith(".mp4"):
                    mime_type = "video/mp4"
                elif url.endswith(".jpg") or url.endswith(".jpeg"):
                    mime_type = "image/jpeg"
                elif url.endswith(".gif"):
                    mime_type = "image/gif"

                if types is not None and hasattr(types, "Part"):
                    media_part = types.Part.from_uri(file_uri=url, mime_type=mime_type)
                else:
                    media_part = {"file_uri": url, "mime_type": mime_type}
                media_parts.append(media_part)

                creative_refs.append(
                    {
                        "ref_id": idx,
                        "url": url,
                        "advertiser_name": c.get("advertiser_name", ""),
                        "campaign_name": c.get("creative_campaign_name", ""),
                        "matched_keywords": c.get("matched_keywords", ""),
                    }
                )

            category_instruction = (
                f"""
                Classify the ad's product category. If it belongs to the target category '{target_category}', return exactly '{target_category}'.
                Otherwise, return a relevant general category (e.g., Fashion, Automotive, Electronics, etc.) or 'Other'.
                """
                if target_category
                else """
                For the category field, simply return 'Other' without performing classification.
                """
            )

            prompt = f"""
            You are a precise marketing verification assistant. Analyze this batch of {len(chunk)} advertisements.

            For each creative provided in the corresponding visual parts, evaluate:
            1. Does the ad content belong to any of these target brands: {list(brand_keywords_map[country_name].keys())}?
               Specifically check for alignment with '{target_brand}'.
               IMPORTANT: The target brand must be the primary advertiser/sponsor of the ad (e.g., promoting its own brand, products, or services).
               Do NOT attribute an ad to a hosting/publisher platform (e.g., Spotify, YouTube, Instagram, TikTok, Meta, Google) merely because:
               - The ad was served on or links to that platform (e.g., `matched_keywords` includes `spotify.com`). `matched_keywords` indicates database matches, NOT proof of brand ownership.
               - The ad depicts generic or platform audio/video player controls (play, pause, progress bar, skip, heart).
               - The ad promotes third-party content (such as a podcast, song, or video) produced by an external sponsor (e.g., an insurance company, retailer, or artist).
               If `advertiser_name` clearly identifies a different company than the target brand, this is strong evidence the ad does NOT belong to the target brand.
            2. What specific product is featured?
            3. {category_instruction}

            Context Details of the Batch:
            {json.dumps(creative_refs, indent=2)}

            Return your response as a valid JSON array containing exactly {len(chunk)} objects matching this structure:
            [
              {{
                "url": "<exact url of the creative>",
                "belongs_to_brand": <boolean>,
                "matched_brand": "<Name of the target brand if True, otherwise null>",
                "product": "<string>",
                "category": "<one of the allowed categories>",
                "explanation": "<string explaining reasoning>"
              }}
            ]
            """

            try:
                gen_cfg = (
                    types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.1,
                        labels={
                            "app": "brand-analytics-agent",
                            "team": "analytics",
                            "env": "prod",
                        },
                    )
                    if types is not None and hasattr(types, "GenerateContentConfig")
                    else {"response_mime_type": "application/json", "temperature": 0.1}
                )
                response = await client.aio.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[*media_parts, prompt],
                    config=gen_cfg,
                )

                raw_text = response.text.strip()
                if raw_text.startswith("```"):
                    lines = raw_text.splitlines()
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines and lines[-1].startswith("```"):
                        lines = lines[:-1]
                    raw_text = "\n".join(lines).strip()

                batch_results = json.loads(raw_text)
                return batch_results if isinstance(batch_results, list) else []
            except Exception as e:
                logger.error(f"Error executing Gemini batch: {e}")
                return [
                    {
                        "url": c["creative_url_supplier"],
                        "belongs_to_brand": False,
                        "matched_brand": None,
                        "product": "Unknown",
                        "category": "Other",
                        "explanation": f"API batch call error: {e!s}",
                    }
                    for c in chunk
                ]

    async def verify_brand_creatives(
        country_name: str, brand: str, creatives: list[dict]
    ) -> list[dict]:
        brand_results = []
        brand_added_urls = set()
        pending_creatives = []

        for c in creatives:
            if has_brand_met_thresholds(country_name, brand):
                break
            url = c["creative_url_supplier"]
            spend = c["spend"]
            impressions = c["impressions"]

            # Domain pre-filtering
            if use_domain_filtering and find_brands_by_domain(
                country_name, c.get("advertiser_domain", ""), brand
            ):
                brand_accumulators[(country_name, brand)]["spend"] += spend
                brand_accumulators[(country_name, brand)]["impressions"] += impressions

                if url not in brand_added_urls:
                    brand_added_urls.add(url)
                    brand_results.append(
                        {
                            "url": url,
                            "country": country_name,
                            "belongs_to_brand": True,
                            "matched_brand": brand,
                            "target_brand": brand,
                            "product": "Domain Match Pass",
                            "category": target_category or "Other",
                            "spend": spend,
                            "impressions": impressions,
                            "explanation": f"Automatically verified via domain match with {brand}.",
                        }
                    )
                continue

            # Cache check
            if url in gemini_cache:
                cached_res = gemini_cache[url]
                belongs = cached_res.get("belongs_to_brand", False)
                matched_brand = cached_res.get("matched_brand")

                if (
                    belongs
                    and matched_brand
                    and matched_brand.lower().strip() == brand.lower().strip()
                ):
                    keep = True
                    if target_category:
                        cat = str(cached_res.get("category", "")).lower().strip()
                        if cat != target_category.lower().strip():
                            keep = False
                    if keep:
                        brand_accumulators[(country_name, brand)]["spend"] += spend
                        brand_accumulators[(country_name, brand)]["impressions"] += (
                            impressions
                        )

                if url not in brand_added_urls:
                    brand_added_urls.add(url)
                    brand_results.append(
                        {
                            "url": url,
                            "country": country_name,
                            "belongs_to_brand": belongs,
                            "matched_brand": matched_brand,
                            "target_brand": brand,
                            "product": cached_res.get("product", "Unknown"),
                            "category": cached_res.get("category", "Other"),
                            "spend": spend,
                            "impressions": impressions,
                            "explanation": cached_res.get("explanation", ""),
                        }
                    )
                continue

            pending_creatives.append(c)

        if has_brand_met_thresholds(country_name, brand):
            logger.info(
                f"Early stop threshold reached upfront for brand {brand} in country {country_name}. Skipping remaining creatives."
            )
            return brand_results

        # Resolve thresholds to check if remaining potential is mathematically sufficient
        base_spend, base_impressions = get_feasibility_defaults(country_name)
        spend_t = (
            spend_threshold
            if spend_threshold is not None
            else base_spend * scale_factor
        )
        impressions_t = (
            impressions_threshold
            if impressions_threshold is not None
            else int(base_impressions * scale_factor)
        )

        acc = brand_accumulators[(country_name, brand)]
        upfront_remaining_spend = sum(c["spend"] for c in pending_creatives)
        upfront_remaining_impressions = sum(c["impressions"] for c in pending_creatives)
        potential = brand_total_potential.get((country_key, brand), {})
        has_more = potential.get("has_more", False)

        if not has_more and (acc["spend"] + upfront_remaining_spend < spend_t) and (
            acc["impressions"] + upfront_remaining_impressions < impressions_t
        ):
            logger.info(
                f"Mathematically impossible to reach feasibility thresholds upfront for brand {brand} in country {country_name}. "
                f"Skipping remaining {len(pending_creatives)} creatives."
            )
            return brand_results

        if pending_creatives:
            video_creatives = [
                c
                for c in pending_creatives
                if str(c.get("creative_url_supplier", "")).endswith(".mp4")
            ]
            image_creatives = [
                c
                for c in pending_creatives
                if not str(c.get("creative_url_supplier", "")).endswith(".mp4")
            ]

            chunks = []
            for vc in video_creatives:
                chunks.append([vc])
            for i in range(0, len(image_creatives), batch_size):
                chunks.append(image_creatives[i : i + batch_size])

            for idx, chunk in enumerate(chunks):
                if has_brand_met_thresholds(country_name, brand):
                    logger.info(
                        f"Early stop threshold reached for brand {brand} in country {country_name}. Skipping remaining creatives."
                    )
                    break

                # Dynamically check if remaining chunks' potential is still sufficient
                if not has_more:
                    remaining_spend = sum(
                        c["spend"]
                        for remaining_chunk in chunks[idx:]
                        for c in remaining_chunk
                    )
                    remaining_impressions = sum(
                        c["impressions"]
                        for remaining_chunk in chunks[idx:]
                        for c in remaining_chunk
                    )
                    if (acc["spend"] + remaining_spend < spend_t) and (
                        acc["impressions"] + remaining_impressions < impressions_t
                    ):
                        logger.info(
                            f"Mathematically impossible to reach feasibility thresholds for brand {brand} in country {country_name} "
                            f"with remaining creatives. Early stopping."
                        )
                        break

                batch_res = await process_batch_chunk(chunk, brand, country_name)
                for res in batch_res:
                    res_url = res.get("url")
                    belongs = bool(res.get("belongs_to_brand", False))
                    matched_brand = res.get("matched_brand")

                    gemini_cache[res_url] = res

                    meta_c = next(
                        (
                            item
                            for item in chunk
                            if item["creative_url_supplier"] == res_url
                        ),
                        None,
                    )
                    c_spend = meta_c["spend"] if meta_c else 0.0
                    c_impressions = meta_c["impressions"] if meta_c else 0

                    if (
                        belongs
                        and matched_brand
                        and matched_brand.lower().strip() == brand.lower().strip()
                    ):
                        keep = True
                        if target_category:
                            cat = str(res.get("category", "")).lower().strip()
                            if cat != target_category.lower().strip():
                                keep = False
                        if keep:
                            brand_accumulators[(country_name, brand)]["spend"] += (
                                c_spend
                            )
                            brand_accumulators[(country_name, brand)][
                                "impressions"
                            ] += c_impressions

                    if res_url not in brand_added_urls:
                        brand_added_urls.add(res_url)
                        brand_results.append(
                            {
                                "url": res_url,
                                "country": country_name,
                                "belongs_to_brand": belongs,
                                "matched_brand": matched_brand,
                                "target_brand": brand,
                                "product": res.get("product", "Unknown"),
                                "category": res.get("category", "Other"),
                                "spend": c_spend,
                                "impressions": c_impressions,
                                "explanation": res.get("explanation", ""),
                            }
                        )

        return brand_results

    # Concurrently verify all brands across countries
    tasks = [
        verify_brand_creatives(country_key, brand, creatives)
        for (country_key, brand), creatives in brand_creatives.items()
        if creatives
    ]

    if not tasks:
        return _persist_and_summarize_verifications(
            [], bq_data, target_category=target_category
        )

    brand_results_list = await asyncio.gather(*tasks)

    flat_results = []
    for r_list in brand_results_list:
        flat_results.extend(r_list)

    final_results = []
    seen_keys = set()
    for res in flat_results:
        k = (res["url"], res.get("country"))
        if k not in seen_keys:
            seen_keys.add(k)
            final_results.append(res)

    return _persist_and_summarize_verifications(
        final_results, bq_data, target_category=target_category
    )
