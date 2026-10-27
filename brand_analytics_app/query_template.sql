-- =============================================================================
-- Brand Analytics Query Template (Secure Parameterized Version)
-- =============================================================================
-- Purpose:  Template for querying advertising data by keyword patterns.
--           This version uses secure BigQuery @parameters for keywords to
--           prevent SQL injection.
-- Version:  3.1 (Parameterized)
-- Spec:     .agents-cli-spec.md
--
-- SECURITY: {BQ_TABLE_NAME} is injected via Python string formatting.
-- The execute_bq_query tool MUST validate this value matches the pattern:
--   ^[a-z0-9_.-]+$
-- before interpolation. See .agents-cli-spec.md §4.1.
--
-- DESIGN NOTES:
-- - The agent provides plain-text keyword arrays via @include_keywords and
--   @exclude_keywords parameters.
-- - SQL automatically escapes special characters and wraps include keywords in
--   word boundaries `(?:^|\W)(...)(?:[._-]|\W|$)` for precision.
-- - Include regex alternatives are ordered longest-first so multi-word matches
--   (e.g., "fanta orange") are captured over shorter substrings.
-- - REGEXP_EXTRACT_ALL captures the exact keywords that matched (using the
--   internal capturing group), enabling Python to map rows back to brands.
-- =============================================================================


-- =============================================================================
-- AGENT INSTRUCTIONS
-- =============================================================================
-- You MUST populate the `include_keywords` and `exclude_keywords` arguments in
-- the execute_bq_query tool with plain-text arrays.
--
-- DO NOT WRITE REGULAR EXPRESSIONS. The SQL template will automatically escape
-- your strings and add necessary word boundaries.
--
-- IMPORTANT: Brand-to-keyword mapping is NOT done in SQL. You must maintain a
-- separate brand_keywords_map dict in Python:
--
--   brand_keywords_map = {
--     "BMW":           ["bmw", "bmw_de", "bmw.com", "bmw.de"],
--     "Mercedes-Benz": ["mercedesbenz", "mercedes-benz.com", "mercedes"]
--   }
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │                    KEYWORD SELECTION RULES                             │
-- ├─────────────────────────────────────────────────────────────────────────┤
-- │                                                                       │
-- │  RULE 1 — PRECISION OVER RECALL                                       │
-- │  Every keyword MUST be specific enough to unambiguously identify the   │
-- │  brand. Never use generic dictionary words as standalone keywords.     │
-- │                                                                       │
-- │  Test: "Would this word appear in ads completely unrelated to the      │
-- │         brand?" If yes, it MUST be prefixed with the brand name or     │
-- │         made into a compound term.                                     │
-- │                                                                       │
-- │    ✗ BAD:   "drachen"         — "dragons", matches games/movies        │
-- │    ✗ BAD:   "kinder"          — "children" in German                   │
-- │    ✗ BAD:   "orange"          — matches color, fruit, telco            │
-- │    ✓ GOOD:  "katjes drachen"  — brand-qualified compound               │
-- │    ✓ GOOD:  "kinder bueno"    — product-specific compound              │
-- │                                                                       │
-- │  RULE 2 — NO KEYWORD OVERLAP BETWEEN BRANDS                          │
-- │  Each keyword pattern MUST match AT MOST ONE brand. This is critical  │
-- │  because Python uses matched_keywords to attribute rows to brands.    │
-- │  Ambiguous keywords break the brand_keywords_map lookup.              │
-- │                                                                       │
-- │  Check both directions:                                               │
-- │  (a) Is this keyword a substring of another brand's keyword?          │
-- │  (b) Is another brand's keyword a substring of this one?              │
-- │                                                                       │
-- │  If overlap exists, resolve by adding brand-specific qualifiers:      │
-- │    ✗ OVERLAP:  Haribo: "gummibärchen"                                 │
-- │               Katjes: "gummibärchen"                                  │
-- │    ✓ RESOLVED: Haribo: "haribo gummibärchen"                          │
-- │               Katjes: "katjes gummibärchen"                           │
-- │                                                                       │
-- │  RULE 3 — LOWERCASE ONLY                                              │
-- │  All keyword patterns MUST be lowercase. The search corpus is         │
-- │  lowercased via LOWER(), and (?i) is applied as a safety net.         │
-- │                                                                       │
-- │  RULE 4 — INCLUDE LOCALIZED VARIATIONS                                │
-- │  For the target market, include:                                      │
-- │  - Official brand name and registered trademarks                      │
-- │  - Product/sub-brand names (e.g., "kinder bueno", "fanta exotik")     │
-- │  - Local-language variations (e.g., "kinder überraschung")            │
-- │  - Official social media handles (WITHOUT @ symbol)                   │
-- │  - Official website domains (e.g., "haribo.com", "haribo.de")         │
-- │  - Well-known aliases or abbreviations                                │
-- │                                                                       │
-- └─────────────────────────────────────────────────────────────────────────┘
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Parameters (bound by execute_bq_query tool)
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE start_date DATE;
DECLARE end_date DATE;
DECLARE target_countries ARRAY<STRING>;
DECLARE include_keywords ARRAY<STRING>;
DECLARE exclude_keywords ARRAY<STRING>;

DECLARE include_regex STRING;
DECLARE exclude_regex STRING;

SET start_date = @start_date;
SET end_date = @end_date;
SET target_countries = @target_countries;
SET include_keywords = @include_keywords;
SET exclude_keywords = @exclude_keywords;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Build combined regexes with auto-escaping
-- ─────────────────────────────────────────────────────────────────────────────
-- Include Regex:
-- - Uses SAFE.REGEXP_REPLACE to escape all regex metacharacters in plain text.
-- - Wraps the alternatives in a capturing group (...). REGEXP_EXTRACT_ALL uses
--   this group to return just the clean keyword string, ignoring the boundaries.
-- - Adds `(?:^|\W)` boundaries to prevent partial-word matches.
-- - Orders by LENGTH(kw) DESC so multi-word terms evaluate before short terms.
SET include_regex = (
  SELECT
    CASE
      WHEN COUNT(*) > 0
      THEN CONCAT(
             '(?i)(?:^|\\W)(',
             STRING_AGG(SAFE.REGEXP_REPLACE(kw, r'([().+*?\[\]{}|^$\\-])', r'\\\1'), '|' ORDER BY LENGTH(kw) DESC),
             ')(?:[._-]|\\W|$)'
           )
      ELSE NULL
    END
  FROM UNNEST(include_keywords) AS kw
);

-- Exclude Regex:
-- - Escapes metacharacters.
-- - NO boundaries (substring match for aggressive noise filtering).
SET exclude_regex = (
  SELECT
    CASE
      WHEN COUNT(*) > 0
      THEN CONCAT('(?i)(?:', STRING_AGG(SAFE.REGEXP_REPLACE(kw, r'([().+*?\[\]{}|^$\\-])', r'\\\1'), '|'), ')')
      ELSE NULL
    END
  FROM UNNEST(exclude_keywords) AS kw
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: Pre-filter source data with partition pruning
-- ─────────────────────────────────────────────────────────────────────────────
-- Partition pruning: occurrence_collectiondate is the table's partition column.
-- Applying BETWEEN start_date AND end_date directly on the source table scan
-- ensures BigQuery skips unneeded partitions at the storage layer, minimizing
-- scanned bytes and query costs.
PreFiltered AS (
  SELECT
    occurrence_collectiondate,
    country,
    advertiser_name,
    advertiser_domain,
    channel_name,
    publisher_name,
    creative_campaign_name,
    creative_landingpage_url,
    creative_url_supplier,
    creative_id,
    creative_inventory_type,
    creative_mime_type,
    creative_size,
    transaction_method,
    occurrence_user_device,
    occurrence_user_app_type,
    social_cta_link,
    social_ad_placement,
    video_url,
    creative_video_title,
    spend,
    impressions
  FROM `{BQ_TABLE_NAME}`
  WHERE occurrence_collectiondate BETWEEN start_date AND end_date
    AND (ARRAY_LENGTH(target_countries) = 0 OR country IN UNNEST(target_countries))
    AND spend > 0
    AND impressions > 0
    AND (creative_url_supplier IS NULL OR NOT ENDS_WITH(creative_url_supplier, '.json'))
),

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4: Aggregate duplicate creatives & clean publisher names
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Normalizes publisher names into standardized major ad platforms (Meta,
--    X, LinkedIn, TikTok, Pinterest, YouTube) or extracts the core domain name.
-- 2. Consolidates redundant occurrence rows across identical creative attributes,
--    summing spend and impressions.
AggregatedRecords AS (
  SELECT
    occurrence_collectiondate,
    EXTRACT(YEAR FROM occurrence_collectiondate) AS year,
    EXTRACT(MONTH FROM occurrence_collectiondate) AS month,
    country,
    advertiser_name,
    advertiser_domain,
    channel_name,
    publisher_name,
    CASE
      WHEN LOWER(publisher_name) LIKE '%//facebook%' OR LOWER(publisher_name) LIKE '%//instagram%' THEN 'Meta'
      WHEN LOWER(publisher_name) LIKE '%//twitter%' OR LOWER(publisher_name) LIKE '%//x.com%' THEN 'X'
      WHEN LOWER(publisher_name) LIKE '%//linkedin%' THEN 'LinkedIn'
      WHEN LOWER(publisher_name) LIKE '%//tiktok%' THEN 'TikTok'
      WHEN LOWER(publisher_name) LIKE '%//pinterest%' THEN 'Pinterest'
      WHEN LOWER(publisher_name) LIKE '%youtube%' THEN 'YouTube'
      WHEN publisher_name LIKE 'http://%' OR publisher_name LIKE 'https://%'
        THEN COALESCE(REGEXP_EXTRACT(publisher_name, r'^https?://(?:www\.)?([^\.]+)\.'), publisher_name)
      ELSE publisher_name
    END AS publisher_name_cleaned,
    creative_campaign_name,
    creative_landingpage_url,
    creative_url_supplier,
    creative_id,
    creative_inventory_type,
    creative_mime_type,
    creative_size,
    transaction_method,
    occurrence_user_device,
    occurrence_user_app_type,
    social_cta_link,
    social_ad_placement,
    video_url,
    creative_video_title,
    SUM(spend) AS spend,
    SUM(impressions) AS impressions
  FROM PreFiltered
  GROUP BY ALL
),

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5: Classify channel & publisher groups
-- ─────────────────────────────────────────────────────────────────────────────
-- Maps raw channels into standardized reporting groups (Social, Video, Display, Other)
-- and groups non-major publisher sites into 'Other Display' or 'Other Video'.
EnrichRecords AS (
  SELECT
    occurrence_collectiondate,
    year,
    month,
    country,
    advertiser_name,
    advertiser_domain,
    channel_name,
    CASE
      WHEN channel_name LIKE 'Social%' THEN 'Social'
      WHEN channel_name LIKE '%Display' AND channel_name NOT LIKE 'Social%'
        AND publisher_name_cleaned <> 'YouTube' THEN 'Display'
      WHEN channel_name LIKE '%Display' AND channel_name NOT LIKE 'Social%'
        AND publisher_name_cleaned = 'YouTube' THEN 'Video'
      WHEN channel_name LIKE '%Video' AND channel_name NOT LIKE 'Social%' THEN 'Video'
      ELSE 'Other'
    END AS channel_clean,
    publisher_name,
    publisher_name_cleaned,
    CASE
      WHEN publisher_name_cleaned NOT IN ('Meta', 'X', 'LinkedIn', 'TikTok', 'Pinterest', 'YouTube')
        AND channel_name LIKE '%Display' THEN 'Other Display'
      WHEN publisher_name_cleaned NOT IN ('Meta', 'X', 'LinkedIn', 'TikTok', 'Pinterest', 'YouTube')
        AND channel_name LIKE '%Video' THEN 'Other Video'
      ELSE publisher_name_cleaned
    END AS publisher_clean,
    creative_campaign_name,
    creative_landingpage_url,
    creative_url_supplier,
    creative_id,
    creative_mime_type,
    creative_size,
    creative_inventory_type,
    transaction_method,
    occurrence_user_device,
    occurrence_user_app_type,
    social_cta_link,
    social_ad_placement,
    video_url,
    creative_video_title,
    spend,
    impressions
  FROM AggregatedRecords
),

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 6: Build search corpus
-- ─────────────────────────────────────────────────────────────────────────────
-- Concatenates relevant textual ad attributes into a single lowercased string
-- for regex matching. LOWER() is applied once here for efficiency.
CorpusBuilt AS (
  SELECT
    occurrence_collectiondate,
    country,
    advertiser_name,
    advertiser_domain,
    channel_name,
    channel_clean AS channel_group,
    publisher_name_cleaned AS publisher_name,
    publisher_clean AS publisher_group,
    creative_campaign_name,
    creative_url_supplier,
    creative_id,
    creative_inventory_type,
    transaction_method,
    occurrence_user_device,
    occurrence_user_app_type,
    spend,
    impressions,
    LOWER(CONCAT(
      COALESCE(advertiser_name, ''), ' ',
      COALESCE(advertiser_domain, ''), ' ',
      COALESCE(creative_campaign_name, ''), ' ',
      COALESCE(creative_landingpage_url, ''), ' ',
      COALESCE(creative_video_title, ''), ' ',
      COALESCE(social_cta_link, '')
    )) AS search_corpus
  FROM EnrichRecords
),

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 7: Filter and extract matched keywords
-- ─────────────────────────────────────────────────────────────────────────────
-- Applies both include and exclude filters in one step.
-- REGEXP_EXTRACT_ALL leverages the capturing group in include_regex to extract
-- the exact plain-text keyword that matched, enabling Python brand attribution.
MatchedData AS (
  SELECT
    cb.occurrence_collectiondate,
    cb.country,
    cb.advertiser_name,
    cb.advertiser_domain,
    cb.channel_name,
    cb.channel_group,
    cb.publisher_name,
    cb.publisher_group,
    cb.creative_campaign_name,
    cb.creative_url_supplier,
    cb.creative_id,
    cb.creative_inventory_type,
    cb.transaction_method,
    cb.occurrence_user_device,
    cb.occurrence_user_app_type,
    cb.spend,
    cb.impressions,
    REGEXP_EXTRACT_ALL(cb.search_corpus, include_regex) AS matched_keywords_raw
  FROM CorpusBuilt cb
  WHERE
    -- Row MUST contain at least one included keyword.
    include_regex IS NOT NULL
    AND REGEXP_CONTAINS(cb.search_corpus, include_regex)
    -- Row MUST NOT contain any excluded keyword.
    AND (exclude_regex IS NULL OR NOT REGEXP_CONTAINS(cb.search_corpus, exclude_regex))
)

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 8: Final aggregated output
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns monthly aggregated data with matched keywords.
-- Python's calculate_brand_metrics uses brand_keywords_map to attribute each
-- row to brands and compute SOV/SOS metrics.
SELECT
  DATE_TRUNC(occurrence_collectiondate, MONTH) AS month,
  UPPER(country) AS country,
  advertiser_name,
  advertiser_domain,
  channel_name,
  channel_group,
  publisher_name,
  publisher_group,
  creative_campaign_name,
  creative_url_supplier,
  creative_id,
  creative_inventory_type,
  transaction_method,
  occurrence_user_device,
  occurrence_user_app_type,
  -- Deduplicate and sort matched keywords into a clean comma-separated string.
  ARRAY_TO_STRING(
    (SELECT ARRAY_AGG(DISTINCT kw ORDER BY kw) FROM UNNEST(matched_keywords_raw) AS kw),
    ', '
  ) AS matched_keywords,
  SUM(spend) AS spend,
  SUM(impressions) AS impressions
FROM MatchedData
GROUP BY ALL
ORDER BY month, country;
