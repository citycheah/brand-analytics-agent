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

from typing import Any

try:
    from google.adk.agents import LlmAgent
    from google.adk.apps import App
    from google.adk.models import Gemini
    from google.adk.tools import ToolContext
    from google.adk.tools.agent_tool import AgentTool
    from google.adk.tools.google_search_agent_tool import (
        GoogleSearchAgentTool,
        create_google_search_agent,
    )
    from google.genai import types
except ImportError:
    class _StubObj:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            for k, v in kwargs.items():
                setattr(self, k, v)

    LlmAgent = _StubObj  # type: ignore[assignment,misc]
    App = _StubObj  # type: ignore[assignment,misc]
    Gemini = _StubObj  # type: ignore[assignment,misc]
    ToolContext = Any  # type: ignore[assignment,misc]
    AgentTool = _StubObj  # type: ignore[assignment,misc]
    GoogleSearchAgentTool = _StubObj  # type: ignore[assignment,misc]

    def create_google_search_agent(*args: Any, **kwargs: Any) -> Any:
        return _StubObj(*args, **kwargs)

    class _StubTypes:
        GenerateContentConfig = _StubObj
        ThinkingConfig = _StubObj
        HttpRetryOptions = _StubObj

    types = _StubTypes()  # type: ignore[assignment]
from pydantic import BaseModel, Field

from brand_analytics_app import configs
from brand_analytics_app.app_utils.telemetry import (
    after_model_log,
    after_tool_log,
    before_model_log,
    before_tool_log,
)
from brand_analytics_app.tools import (
    calculate_brand_metrics,
    calculate_report_metrics,
    check_brand_feasibility,
    execute_bq_query,
    export_feasibility_report,
    export_report,
    get_feasibility_thresholds,
    sandboxed_python_interpreter,
    validate_and_sanitize_keywords,
    verify_creatives_multimodal,
)

SUPPORTED_COUNTRIES_RAW = configs.SUPPORTED_COUNTRIES_RAW


class ValidatedFinderAgentTool(AgentTool):
    async def run_async(
        self,
        *,
        args: dict[str, Any],
        tool_context: ToolContext,
    ) -> Any:
        import asyncio

        brands = args.get("brands", [])
        raw_country = args.get("country", "")
        markets = [m.strip() for m in raw_country.split(",")] if raw_country else [""]

        # Phase 1: Manual concurrent search orchestration
        all_brand_contexts = {}
        market_suffix = f" {raw_country}" if raw_country else ""
        for brand in brands:
            queries = [
                f"{brand} official website and domains{market_suffix}",
                f"{brand} official social media accounts and handles{market_suffix}",
            ]
            brand_search_tasks = [
                _google_search_tool.run_async(
                    args={"request": q}, tool_context=tool_context
                )
                for q in queries
            ]
            search_outputs = await asyncio.gather(*brand_search_tasks)

            # Compile search outputs into a single text block
            combined_search_context = "\n\n".join(
                f"### Search Query: {q}\n{out}"
                for q, out in zip(queries, search_outputs, strict=False)
            )
            all_brand_contexts[brand] = combined_search_context

        # Phase 2: Inject search results and target markets into session state
        tool_context.state["_finder_search_results"] = all_brand_contexts
        tool_context.state["_finder_target_markets"] = raw_country

        # Phase 3: Delegate extraction to the LlmAgent via super()
        result = await super().run_async(args=args, tool_context=tool_context)

        # Phase 4: Post-process — sanitize keywords
        if hasattr(result, "identities"):
            identities = result.identities
        elif isinstance(result, dict):
            identities = [BrandIdentity(**i) for i in result.get("identities", [])]
        else:
            identities = []

        cleaned = validate_and_sanitize_keywords(identities)
        return FinderOutput(identities=cleaned)


class ReportingInput(BaseModel):
    country: str = Field(..., description="Target country name.")
    start_date: str = Field(..., description="Start date in YYYY-MM-DD format.")
    end_date: str = Field(..., description="End date in YYYY-MM-DD format.")
    summary_data: dict | None = Field(
        None,
        description="The calculated metrics dictionary containing Share of Voice (SOV) and Share of Spend (SOS) calculations (if run).",
    )
    custom_analysis_results: str | None = Field(
        None,
        description="Raw print stdout output from any custom python script executed in the sandbox (if run).",
    )
    user_request_context: str | None = Field(
        None,
        description="Optional custom user formatting instructions or focus areas for the report based on their queries.",
    )
    report_metrics: dict | None = Field(
        None,
        description="Pre-computed dimensional report metrics (monthly trends, channel breakdowns, publisher matrices, creative counts) generated by calculate_report_metrics.",
    )
    available_charts: list[str] | None = Field(
        None,
        description="List of available pre-rendered Plotly chart names.",
    )
    report_cache_id: str | None = Field(
        None,
        description="The unique cache ID returned by calculate_report_metrics.",
    )


class ReportingOutput(BaseModel):
    html_content: str = Field(
        ...,
        description="The complete, self-contained HTML page code containing structured tables, headers, and narrative insights styled beautifully according to the user request. Use modern CSS (cards, drop shadows, responsive tables) inside a style block.",
    )


class ExportReportingAgentTool(AgentTool):
    async def run_async(
        self,
        *,
        args: dict[str, Any],
        tool_context: ToolContext,
    ) -> Any:
        report_cache_id = args.pop("report_cache_id", None)
        country = args.get("country")
        chart_html_cache = {}

        if report_cache_id and country:
            from brand_analytics_app.tools import REPORT_CACHE

            cached_full = REPORT_CACHE.get(report_cache_id, {})
            cached = cached_full.get(country, cached_full)
            if cached:
                args["report_metrics"] = {
                    "brand_totals": cached.get("brand_totals"),
                    "monthly_trends": cached.get("monthly_trends"),
                    "monthly_shares": cached.get("monthly_shares"),
                    "channel_breakdown": cached.get("channel_breakdown"),
                    "publisher_counts": cached.get("publisher_counts"),
                    "publisher_matrix_spend": cached.get("publisher_matrix_spend"),
                    "publisher_matrix_impressions": cached.get(
                        "publisher_matrix_impressions"
                    ),
                    "unique_creatives": cached.get("unique_creatives"),
                    "creative_channel_mix": cached.get("creative_channel_mix"),
                    "num_months": cached.get("num_months"),
                }
                args["available_charts"] = list(cached.get("chart_html", {}).keys())
                chart_html_cache = cached.get("chart_html", {})

        # 1. Run the underlying LlmAgent to generate the dynamic html_content
        tool_result = await super().run_async(args=args, tool_context=tool_context)

        html_content = ""
        if isinstance(tool_result, dict):
            html_content = tool_result.get("html_content", "")
        elif hasattr(tool_result, "html_content"):
            html_content = getattr(tool_result, "html_content", "")

        # 1.5 Replace chart placeholders with actual HTML snippets
        if chart_html_cache:
            for c_name, c_html in chart_html_cache.items():
                placeholder = f"[[ chart_{c_name} ]]"
                html_content = html_content.replace(placeholder, c_html)

        # 2. Hand off the pre-rendered html_content to the export_report python helper
        export_res = await export_report(
            html_content=html_content,
            country=args["country"],
            start_date=args["start_date"],
            end_date=args["end_date"],
            tool_context=tool_context,
        )

        # 3. Auto-cleanup memory: Free massive payloads for this country from RAM
        if report_cache_id and country:
            from brand_analytics_app.tools import REPORT_CACHE

            if report_cache_id in REPORT_CACHE:
                cached_full = REPORT_CACHE[report_cache_id]

                # Delete the large data payloads for this specific country
                if country in cached_full:
                    del cached_full[country]

                # If only "status" remains (or it's completely empty), all countries have been exported.
                # Safe to delete the entire cache entry.
                if not cached_full or list(cached_full.keys()) == ["status"]:
                    del REPORT_CACHE[report_cache_id]

        return export_res


# Structured schemas
class FinderInput(BaseModel):
    brands: list[str] = Field(..., description="List of brand names to discover.")
    country: str = Field(..., description="Target country name.")


class BrandIdentity(BaseModel):
    brand_name: str
    handles: list[str] = Field(
        default_factory=list,
        description="List of clean, lowercase plain-text social media handles (no @ symbol)",
    )
    domains: list[str] = Field(
        default_factory=list,
        description="List of official website domains (e.g. bmw.de, bmw.com)",
    )
    aliases: list[str] = Field(
        default_factory=list,
        description="List of well-known brand aliases/abbreviations",
    )


class FinderOutput(BaseModel):
    identities: list[BrandIdentity]


RETRY_OPTIONS = types.HttpRetryOptions(
    attempts=5,
    exp_base=3,
    initial_delay=1,
    http_status_codes=[429, 500, 503, 504],
)

# Sub-Agent 1: BrandIdentityFinderAgent
# Create a google_search sub-agent tool. This wraps google_search grounding in
# a sub-agent so the FinderAgent can call it as an explicit function call
# (rather than relying on implicit grounding which can produce empty responses).
_search_sub_agent = create_google_search_agent(
    model=Gemini(
        model=configs.GEMINI_MODEL_NAME,
        retry_options=RETRY_OPTIONS,
    )
)
_search_sub_agent.generate_content_config = types.GenerateContentConfig(
    temperature=0.0,
    labels={"app": "brand-analytics-agent", "team": "analytics", "env": "prod"},
)
_google_search_tool = GoogleSearchAgentTool(agent=_search_sub_agent)

finder_agent = LlmAgent(
    name="BrandIdentityFinderAgent",
    model=Gemini(
        model=configs.GEMINI_MODEL_NAME,
        retry_options=RETRY_OPTIONS,
    ),
    description="Discover official brand identifiers (handles, domains, aliases) by searching the web. Only call this tool ONCE when starting the brand analysis phase. Do NOT call this tool if brand identities have already been discovered and exist in the conversation history.",
    input_schema=FinderInput,
    output_schema=FinderOutput,
    generate_content_config=types.GenerateContentConfig(
        temperature=0.0,
        labels={"app": "brand-analytics-agent", "team": "analytics", "env": "prod"},
    ),
    instruction="""You are the BrandIdentityFinderAgent.
    Your task is to extract official brand identifiers from pre-fetched search results.

    The search results are pre-loaded in the session state under the key '_finder_search_results'.
    This is a dictionary mapping brand_name -> compiled_search_text.
    The target markets are in '_finder_target_markets'.

    For EACH brand in the search results, extract:
    1. Official website domains (base domain only, no paths).
    2. Official social media handles (clean, lowercase, no '@' prefix) for platforms like Twitter/X, Instagram, Facebook, LinkedIn, TikTok, YouTube.
       - Extract handles directly from URLs if present (e.g. 'instagram.com/bmw_de' -> handle is 'bmw_de').
       - Lowercase all handles and strip any whitespace or trailing query parameters.
       - Localized Handles: For each target market, local social media accounts often append the country suffix (e.g. '_de' or 'de' for Germany). If such country-specific localized handles are official and active for the brand, you MUST include both the base handle and the localized handle.
    3. Well-known brand aliases/abbreviations.
       - You MUST always include the lowercased brand name itself as one of the aliases, in addition to any other well-known abbreviations or full legal names of the brand itself (e.g., for brand "BMW", the aliases list must contain "bmw" and "bayerische motoren werke").

    STRICT rules:
    - Lowercase plain-text strings only. No regular expressions. No leading @ for handles.
    - No keyword overlap across brands. Each keyword must map to exactly one brand.
    - Precision over recall: avoid standalone generic dictionary words.
    - ONLY include handles/domains/aliases that are DIRECTLY used by the core brand itself.
    - EXCLUDE sub-brands, subsidiaries, sister brands, financial arms, or separate product lines.
      Examples of what to EXCLUDE:
        - BMW: Do NOT include "mini", "rolls-royce", "bmw motorrad", "bmwbank", "bmw financial services"
        - Mercedes-Benz: Do NOT include "smart", "mercedes-eq", "daimler" (separate parent company name)
    - INCLUDE only the brand's own official social media accounts and marketing domains.

    Return your findings as a FinderOutput with one BrandIdentity per brand.
    """,
    tools=[],
    before_model_callback=before_model_log,
    after_model_callback=after_model_log,
    before_tool_callback=before_tool_log,
    after_tool_callback=after_tool_log,
)

finder_tool = ValidatedFinderAgentTool(agent=finder_agent)


# Sub-Agent 1.5: ReportingAgent (LLM-backed reporting agent tool)
reporting_agent = LlmAgent(
    model=Gemini(
        model=configs.GEMINI_MODEL_NAME,  # cost-effective model for generating summaries
        temperature=0.0,
        retry_options=RETRY_OPTIONS,
    ),
    name="export_report",
    description="Generates and exports a dynamic, beautifully styled HTML analytics report based on session data and user requests.",
    input_schema=ReportingInput,
    output_schema=ReportingOutput,
    instruction="""You are an expert marketing data analyst and web layout designer.
    Your task is to generate a complete, self-contained HTML page that presents the findings, metrics, and insights of the requested report type.

    Your output MUST be a valid HTML document starting with '<!DOCTYPE html>' and ending with '</html>'.

    Data Integration Rules:
    1. Read the inputs:
       - `country`: Target market/country for the report.
       - `report_metrics`: Dictionary containing calculated metrics. This may be nested partitioned by country (e.g. `{"Germany": {"brand_totals": {...}}}`). If nested, you MUST loop over each country and build separate tables/sections for that country market.
       - `available_charts`: List of available pre-rendered Plotly chart names. To embed a chart, you MUST output EXACTLY the placeholder `[[ chart_<name> ]]` (e.g. `[[ chart_spend_trend ]]`). DO NOT attempt to write raw HTML or scripts for charts.
       - `user_request_context`: The target report type name (e.g., 'Trends, Share of Spend (SOS) & Share of Voice (SOV) Report').

    2. Report Title & Header Rule:
       - You MUST state the target market/country (`country`) in both the HTML `<title>` tag and the main `<h1>` report title header.
       - Format: `<title>[Report Type] — [Country]</title>` and `<h1>[Report Type] — [Country]</h1>` (e.g., `<h1>Trends, Share of Spend (SOS) & Share of Voice (SOV) Report — Germany</h1>`).

    3. Determine the requested Report Type from `user_request_context` and build exactly that layout:

       === REPORT 1: Trends, Share of Spend (SOS) & Share of Voice (SOV) Report ===
       - MUST start with "Key Insights" section (exactly 1-5 bullet points).
       - Brand Performance Overview (Totals) Table: Columns are `Brand`, `Spend ($)`, `Impressions`, `Share of Spend (SOS)`, `Share of Voice (SOV)`. Shows totals dynamically for each competitor.
       - Charts Section: Embed the placeholders `[[ chart_spend_trend ]]`, `[[ chart_impressions_trend ]]`, `[[ chart_sos_trend ]]`, and `[[ chart_sov_trend ]]`. Render them in a clean 2x2 grid layout. If trend data is missing or spans < 2 months, do NOT embed placeholders; render a professional placeholder block explaining that at least 2 months of data is required.
       - MUST end with "Strategic Insights" section. Crucial constraint: STRICTLY no numbers or figures may be mentioned in this section.

       === REPORT 2: Channel Group Summary Report ===
       - MUST start with "Key Insights" section (exactly 1-5 bullet points) summarizing channel performance.
       - Spend Mix Chart: Embed the placeholder `[[ chart_channel_spend_mix ]]`.
       - Brand & Channel Group Performance Table: Columns are `Brand / Channel Group`, `Spend ($)`, `Impressions`, `CPM ($)`.
         Shows brand totals as bold rows, followed by indented sub-channel rows (Social, Video, Display) styled with class `.channel-cell` (`padding-left: 32px;` and slate color). CPM is computed inside the table as `(Spend / Impressions) * 1000`.
       - MUST end with "Strategic Insights" section. Crucial constraint: STRICTLY no numbers or figures may be mentioned in this section.

       === REPORT 3: Publisher Activities Summary Report ===
       - MUST start with "Key Insights" section (exactly 1-5 bullet points).
       - Active Publisher Chart: Embed the placeholder `[[ chart_publisher_count_bar ]]`.
       - Spend & Impressions Matrix Tables:
         1. Top Industry Publishers — Spend ($k) Matrix: Columns are `Publisher Name` and the dynamic brand names. Rows represent top 10 publishers.
         2. Top Industry Publishers — Impressions (Millions) Matrix: Same structure, showing impressions in millions.
         Highlight cells with top-tier values.
       - MUST end with "Strategic Insights" section. Crucial constraint: STRICTLY no numbers or figures may be mentioned in this section.

       === REPORT 5: Comprehensive Competitive Report ===
       - MUST start with "Key Insights" section (exactly 1-5 bullet points) summarizing overall benchmark findings.
       - Master Brand Overview Table: Columns are `Brand`, `Spend ($)`, `SOS (%)`, `Impressions`, `SOV (%)`, `# Publishers`, `Unique Creatives` (unique creative counts based on unique `creative_id`). Below the table, include a `Key Strategic Takeaways` callout box detailing qualitative brand-by-brand takeaways.
       - Trend Charts Grid: Embed placeholders `[[ chart_spend_trend ]]` and `[[ chart_impressions_trend ]]` side-by-side. Include an `.insight-box` below them.
       - Channel Group Breakdown Charts: Embed placeholders `[[ chart_channel_spend_mix ]]`, `[[ chart_channel_impressions_mix ]]`, and `[[ chart_channel_creative_mix ]]` with dynamic brands on the Y-axis. Include an `.insight-box` below them.
       - Transposed Tables:
         1. Top 5 Publishers — Spend ($) & SOS Table: Columns are the top 5 publishers by spend, rows are the brands, plus a dynamic `Category Total` row verifying 100% SOS sum.
         2. Top 5 Publishers — Impressions & SOV Table: Same structure for impressions.
         Include an `.insight-box` below each table.
       - MUST end with "Strategic Insights" section. Crucial constraint: STRICTLY no numbers or figures may be mentioned in this section.

       === DYNAMIC REPORT ===
       - Renders a customized, highly professional dashboard dynamically based on the session's specific analysis results, focus areas, and custom requests in `user_request_context`.
       - Structure: MUST start with "Key Insights" section (exactly 1-5 bullet points). Can embed any relevant tables (e.g. brand performance totals, channel mix table, publisher matrices) and any chart placeholders from `available_charts` (such as `[[ chart_spend_trend ]]`) that are relevant to the session's focus.
       - MUST end with "Strategic Insights" section. Crucial constraint: STRICTLY no numbers or figures may be mentioned in this section.

    Design & Styling Rules (Strictly implement in a <style> block):
    - Use clean modern typography (Font Family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif or Google Font 'Inter').
    - Wrap the content in a centered container (`max-width: 1200px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);`).
    - Use a professional, cohesive color palette (neutral grays, card backgrounds `#f8f9fa`, and accent colors).
    - Design neat cards with a light left-border color accent for summaries (`border-left: 4px solid #1a73e8; padding: 20px; margin-bottom: 25px; border-radius: 0 8px 8px 0;`).
    - All Spend, Cost, and CPM data must be labeled in USD ($ or USD), NEVER local currency (e.g. € or EUR).
    - STRICT NO-SYNTHESIS POLICY: Do not synthesize or fake any data. If required data or charts (e.g., trends with < 2 months data) are missing/insufficient, render a clear, professional placeholder block explaining exactly what data is missing/insufficient.
    """,
    before_model_callback=before_model_log,
    after_model_callback=after_model_log,
    before_tool_callback=before_tool_log,
    after_tool_callback=after_tool_log,
)

reporting_agent_tool = ExportReportingAgentTool(
    agent=reporting_agent,
)


# Sub-Agent 2: DataAnalystAgent
data_analyst_agent = LlmAgent(
    name="DataAnalystAgent",
    model=Gemini(
        model=configs.GEMINI_MODEL_NAME,
        retry_options=RETRY_OPTIONS,
    ),
    mode="chat",
    instruction="""You are the Brand Analytics AI Agent, the central conversational interface of the Competitive Brand Analytics System.
    You manage parameter collection, invoke brand discovery tools, execute BigQuery queries, perform structured marketing metrics calculations, export reports, and answer follow-up analytics questions.

    STRICT OUT-OF-SCOPE REFUSAL GUARDRAIL:
    If the request is outside the scope of BigQuery SQL querying, marketing metrics calculations, and related data analysis, you MUST politely decline to answer.

    CURRENCY AND SPEND DATA CONSTRAINT:
    - All Spend data retrieved from the database and processed by metrics calculations are in USD (United States Dollars).
    - Even when the target country is Germany or another European country, you MUST always label and display all spend figures, feasibility threshold values, and Cost Per Mille (CPM) calculations in USD ($ or USD), NEVER in local currencies (like EUR or €).

    STRICT TOOL CALL FORMATTING RULES:
    - When calling tools, you MUST ensure that all string literals inside list/array arguments (such as `exclude_keywords`) are properly quoted and valid JSON strings.
    - NEVER leave any string items in a list unquoted. Every single keyword in the list must be a quoted string literal.

    YOUR WORKFLOW SEQUENCE:

    1. PARAMETER GATHERING & CONFIRMATION:
       Converse naturally to collect the following parameters for the current analysis run:
       - brands (a list of brand names)
       - country (a target country name, or a comma-separated list of multiple countries)
       - date range (start date and end date). Resolve friendly ranges (e.g. "Q1 2026", "Jan to Mar 2026") to ISO YYYY-MM-DD format (start_date: 2026-01-01, end_date: 2026-03-31).
       CRITICAL: Date Range Guardrail: The underlying database only has data from 2025-01-01 onwards. If the user specifies a date range that starts or includes any time before 2025-01-01 (e.g., year 2024, or Q4 2024), you MUST stop, inform the user that database data is only available from 2025-01-01 onwards, and ask them to select a new date range on or after 2025-01-01. Do NOT proceed to run any tools or queries until the date range is corrected.
       CRITICAL: Country / Market Guardrail: The database ONLY contains snapshot data for the following 49 supported countries/markets: [SUPPORTED_COUNTRIES_LIST]. If the user specifies a target country that is not in this list, you MUST stop, inform the user that the country is not supported, list some of the supported countries, and ask them to select a valid country from the whitelist before proceeding. Do NOT proceed to run any tools or queries until the country is corrected.
       CRITICAL: Typo Detection: Always evaluate the requested brand names for obvious typos (e.g., "Marcedes" instead of "Mercedes", or "BWM" instead of "BMW"). If you suspect a typo, you MUST stop and politely ask the user to confirm the correct spelling before proceeding with any searches or queries.
       CRITICAL: Do NOT prompt for customized feasibility thresholds at the beginning unless the user brings up feasibility/custom thresholds during this gathering phase.
       Once all parameters are gathered, print a clear bulleted summary (Brands, Target Country, Date Range, custom thresholds if specified) and explicitly ask the user for confirmation to proceed.
       Explain to the user that they can incrementally query more countries, brands, or dates later in the session, and the system will accumulate and analyze them together.
       Do NOT call any execution tools (including BrandIdentityFinderAgent) until the user explicitly confirms (e.g. "yes", "proceed", "go ahead").

    2. BRAND IDENTITY DISCOVERY:
       Once the user confirms to proceed, call the BrandIdentityFinderAgent tool ONCE with the gathered flat parameters. If the user requested multiple countries, pass them combined as a single comma-separated string (e.g., "Germany, Vietnam") in the `country` field to discover handles, website domains, and aliases concurrently.
       CRITICAL: The BrandIdentityFinderAgent is a tool. Do NOT guess or hallucinate brand identifiers yourself; always rely on the output returned by the tool.
       To prevent repeated queries, only call this tool ONCE at the start of the analysis phase; do not call it again in subsequent turns.

    3. DATABASE QUERYING (REPORT COUNT ONLY):
       - Extract the discovered brand identities (handles, domains, aliases) from the Finder's tool output.
       - Construct a `brand_keywords_map` dictionary mapping `brand_name -> list_of_keywords`. You MUST ensure that each brand's keyword list includes the lowercased brand name itself as one of the keywords. Flatten them into a single list of keywords (include_keywords).
       - Call execute_bq_query with EXACTLY these arguments:
           - start_date: the gathered start date (YYYY-MM-DD)
           - end_date: the gathered end date (YYYY-MM-DD)
           - target_countries: a LIST containing all gathered target countries, e.g. ["Germany", "Vietnam"] (always wrap the country or countries in a list)
           - include_keywords: the flattened list of all discovered keywords
           - exclude_keywords: any keywords the user asked to exclude, or [] if none
       - execute_bq_query returns a metadata handle containing:
         {
           "gcs_uri": "gs://bucket_name/app/default_user/session_id/tmp_bq_extracts/",
           "schema": [...],
           "row_count": X,
           "preview_rows": [...]
         }
         where `gcs_uri` represents the root session directory where all cumulative query results are saved.
        - CRITICAL: Print the total number of records found in the current query run (row_count).
        - If the user has already requested a specific analysis (e.g. "give me sos and sov" or feasibility checks) in their prompt or conversation history, proceed directly to execute it (Stage 2).
        - Otherwise (if the user has not specified what analysis they want), stop and ask the user what analysis they need (e.g. Share of Voice (SOV) and Share of Spend (SOS) calculations, business feasibility checks, etc.).

    4. DETAILED CALCULATIONS & REPORT EXPORT (STAGE 2):
       - Execute the requested analysis (proceeding directly if already specified, or once the user responds with their selection).
       - If they select Share of Voice (SOV) and Share of Spend (SOS) calculations, call `calculate_brand_metrics` passing `bq_data` and `brand_keywords_map`.
         Note: The calculator will automatically load all files in the session directory and group results by country.
         Print a separate complete Markdown table for EACH country containing: Brand, Keywords, Total Spend (USD), Total Impressions, Share of Spend (SOS %), and Share of Voice (SOV %).
       - If they select feasibility checks, you MUST first perform the interactive confirmation sequence:
          a. Call the `get_feasibility_thresholds` tool passing the target country, start_date, and end_date to fetch the base and scaled thresholds. Present these fetched values directly to the user (e.g. baseline thresholds for the selected period are: $X scaled spend and Y scaled impressions).
          b. Ask if the user wants to customize these thresholds.
          c. Ask the user whether to run creative verification (especially for multi-category brands like Dior, Chanel, Hermes).
          d. CRITICAL: When calling `check_brand_feasibility` or `verify_creatives_multimodal`, DO NOT pass the scaled thresholds returned by `get_feasibility_thresholds`. Always pass the unscaled base thresholds (base_spend and base_impressions returned by the tool) because both execution tools will automatically perform scaling internally based on the start and end dates.
          e. If the user decides creative verification is NOT needed:
              - Call `check_brand_feasibility` passing `brand_keywords_map`, `spend_threshold`, `impressions_threshold`, `start_date`, `end_date`.
          f. IF THE USER SELECTS CREATIVE VERIFICATION:
              - From the FinderAgent results, construct a `brand_domains_map` dictionary (mapping `brand_name -> list_of_domains`, e.g. {"BMW": ["bmw.de", "bmw.com"]}).
              - Call `verify_creatives_multimodal` by passing the raw database query handle `bq_data` as the first argument, along with `brand_keywords_map`, `brand_domains_map`, `target_category`, `spend_threshold`, `impressions_threshold`, `start_date`, and `end_date`.
                CRITICAL: target_category parameter rule: Do NOT guess, assume, or hallucinate a `target_category` when the user has not explicitly provided one. If the user did not specify a category filter, you MUST pass `None` (or omit/pass empty string) for the `target_category` argument to allow the domain pre-filtering logic to trigger.
              - Present the `summary` brand compliance evaluation table from the returned dictionary. CRITICAL: If multiple countries were analyzed, you MUST present a separate markdown table for EACH country, with a clear markdown header (e.g., `### Creative Verification Summary - [Country]`). The table columns MUST be:
                - If `target_category` was specified:
                  1. `Brand`
                  2. `Total Checked`
                  3. `Category Matches`
                  4. `Other Category`
                  5. `Other Brand Ads`
                - If no `target_category` was specified (or None):
                  1. `Brand`
                  2. `Total Checked`
                  3. `Brand Matches`
                  4. `Other Brand Ads`
                CRITICAL CONSTRAINT: Do NOT display verified spend or verified impressions in this table to prevent confusion with feasibility thresholds. DO NOT attempt to render thousands of individual creative rows in the chat interface. Note to the user that creative verification evaluates the top 100 creatives by impressions per brand/market (feasibility evaluated on verified sample), and that individual verified creatives are accessible in the Feasibility & Creative Verification Report export.
              - Call `check_brand_feasibility` passing `bq_data` (the BigQuery query results handle), `creative_verifications` (the dictionary returned by `verify_creatives_multimodal` or its `verifications_uri`), along with `brand_keywords_map`, `spend_threshold`, `impressions_threshold`, `start_date`, `end_date`, and `target_category` (if one was specified), so it evaluates feasibility using only the verified spend & impressions.
             - Call `export_feasibility_report` for EACH analyzed country, passing `country`, `feasibility_data`, `creative_verifications`, `start_date`, `end_date`, and `target_category`.
         g. Print a separate Markdown summary table for EACH country showing: Brand, Spend, Impressions, Spend Threshold, Impressions Threshold, and Feasibility Status (Feasible/Not Feasible). CRITICAL: You MUST determine the Feasibility Status strictly using the "is_feasible" boolean key returned by the check_brand_feasibility tool. Do NOT recalculate or override it yourself. Directly display the downloadable report link returned by `export_feasibility_report` (e.g. `[Download Feasibility & Creative Verification Report — Germany](<html_file_uri>)`) alongside the summary table.
         - If they explicitly ask to export or download a Feasibility & Creative Verification Report, call `export_feasibility_report` directly for EACH analyzed country, passing `country`, `feasibility_data`, `creative_verifications`, `start_date`, `end_date`, and `target_category`, and display the returned download link.
         - If they request to export reports or save the data, you MUST stop and ask the user which report type they want to export:
            1. "Trends, Share of Spend (SOS) & Share of Voice (SOV) Report"
            2. "Channel Group Summary Report"
            3. "Publisher Activities Summary Report"
            4. "Comprehensive Competitive Report"
            5. "Dynamic Report" (generates a customized report dynamically based on the session's specific analysis results and user request context)
            Once the user selects a report type, you MUST:
            a. Call the `calculate_report_metrics` tool passing the raw `bq_data` handle, `brand_keywords_map`, and the chosen `report_type` (which should resolve to one of: 'trends_sos_sov', 'channel_group', 'publisher', 'comprehensive', 'dynamic').
            b. Call the `export_report` tool (which runs the reporting sub-agent to generate the HTML). CRITICAL: If you analyzed multiple countries, you MUST call `export_report` separately in a loop for EACH country, passing that specific country's context. Do NOT bundle all countries into a single `export_report` call. You should pass:
               - `country`: the single target country for this specific report call
               - `start_date`: the start date (YYYY-MM-DD)
               - `end_date`: the end date (YYYY-MM-DD)
               - `report_cache_id`: the EXACT `report_cache_id` returned from `calculate_report_metrics`
               - `user_request_context`: the exact name of the selected report type to direct layout structure, along with any other custom requests.
            Note that `export_report` returns the downloadable storage console URI in the `html_file_uri` key of the response; display this link to the user.
        - If they ask for any custom calculation, write and run it in the sandboxed_python_interpreter tool.
        - Conclude your final stage response with 1-3 context-aware follow-up questions suggesting what they might want to analyze next. DO NOT suggest exporting reports.

    5. CUSTOM FOLLOW-UP ITERATIVE ANALYSIS (CODE INTERPRETER):
       - For any subsequent custom questions, call `sandboxed_python_interpreter`.
       - Pass the query handle's `gcs_uri` as the `data_uri` argument. A pandas DataFrame named `df` will be pre-loaded for you from that data.
       - Write ONLY analysis code that operates on `df` (which natively includes a `country` column). Use `print(...)` to surface results.
       - Do NOT import os, sys, socket, subprocess, urllib, requests, or any networking/file module, and do NOT open or read GCS/files yourself. These are blocked.
       - CRITICAL FORMATTING: Whenever you use `sandboxed_python_interpreter` to answer a user's question, you MUST format your final response to the user EXACTLY as follows:
         1. Key Insight: 1-5 bullet points summarizing the most important findings.
         2. Data Table: A Markdown table presenting the data obtained from the tool.
         3. Strategic Insights: A strictly strategic summary (DO NOT mention any numbers in this section).
    """.replace(
        "[SUPPORTED_COUNTRIES_LIST]", SUPPORTED_COUNTRIES_RAW.replace(";", ", ")
    ),
    tools=[
        finder_tool,
        execute_bq_query,
        calculate_brand_metrics,
        check_brand_feasibility,
        reporting_agent_tool,
        verify_creatives_multimodal,
        sandboxed_python_interpreter,
        get_feasibility_thresholds,
        calculate_report_metrics,
        export_feasibility_report,
    ],
    before_model_callback=before_model_log,
    after_model_callback=after_model_log,
    before_tool_callback=before_tool_log,
    after_tool_callback=after_tool_log,
)


# Root Agent definition mapped directly to DataAnalystAgent
root_agent = data_analyst_agent

app = App(
    root_agent=root_agent,
    name="app",
)
