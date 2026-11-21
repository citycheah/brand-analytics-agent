"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EU_AUTO_BRANDS, usePortalContext } from "@/components/PortalProvider";
import {
  fmtCompact,
  fmtUsd,
  getPortalThemes,
  getPortalVelocity,
  PortalThemesResponse,
  VelocityBreakoutItem,
  VelocityResponse,
} from "@/lib/api";

const COUNTRIES = ["Germany", "United Kingdom", "France"];
const BRAND_FILTERS = ["", ...EU_AUTO_BRANDS];

const BRAND_CHANNEL_PATTERNS: Record<string, RegExp> = {
  BMW: /\bbmw\b/i,
  "Mercedes-Benz": /\b(mercedes|mercedes-benz|amg)\b/i,
  Audi: /\baudi\b/i,
  Porsche: /\bporsche\b/i,
};

function matchesBrandFilter(v: VelocityBreakoutItem, targetBrand: string): boolean {
  if (!targetBrand) return true;
  if (v.brand_id) return v.brand_id === targetBrand;
  const title = v.channel_title ?? "";
  const pattern = BRAND_CHANNEL_PATTERNS[targetBrand];
  if (pattern) return pattern.test(title);
  return title.toLowerCase().includes(targetBrand.toLowerCase());
}

export default function ThemesPage() {
  const { myBrand } = usePortalContext();
  const [country, setCountry] = useState("Germany");
  const [brandId, setBrandId] = useState("");
  const [data, setData] = useState<PortalThemesResponse | null>(null);
  const [velocity, setVelocity] = useState<VelocityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getPortalThemes(country, brandId || undefined),
      getPortalVelocity(20, brandId || undefined).catch(() => null),
    ])
      .then(([themesRes, velRes]) => {
        if (!cancelled) {
          setData(themesRes);
          setVelocity(velRes);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [country, brandId]);

  const sos = data?.sos_sov;
  const tf = data?.themes_and_fatigue;
  const themesList = tf?.themes ?? [];
  const fatigueList = tf?.fatigue_alerts ?? [];
  const scatterPoints = tf?.scatter_points ?? [];
  const jaccardList = tf?.jaccard_overlaps ?? [];
  const categoryHhi = tf?.category_hhi ?? 0;

  const myBrandRow = sos?.brands.find((b) => b.brand_id === myBrand);
  const topCompetitorRow = sos
    ? [...sos.brands]
        .filter((b) => b.brand_id !== myBrand)
        .sort((a, b) => b.sov_pct - a.sov_pct)[0]
    : undefined;
  const selectedBrandRow =
    brandId && sos ? sos.brands.find((b) => b.brand_id === brandId) : undefined;

  const myVoiceGap = myBrandRow ? myBrandRow.sov_pct - myBrandRow.sos_pct : 0;
  const selectedGap = selectedBrandRow
    ? selectedBrandRow.sov_pct - selectedBrandRow.sos_pct
    : 0;

  const whitespaceTheme =
    themesList.find((t) => t.scope === "brand_exclusive_whitespace") ?? themesList[0];

  const rawBreakouts = velocity?.breakout_queue ?? [];
  const filteredBreakouts = brandId
    ? rawBreakouts.filter((v) => matchesBrandFilter(v, brandId))
    : rawBreakouts;
  const predictedBreakoutCount =
    velocity?.predicted_breakouts ??
    filteredBreakouts.filter((v) => v.is_predicted_breakout).length;

  const focusBrandForBreakout = brandId || myBrand;
  const matchingBreakout =
    filteredBreakouts.find(
      (v) => v.is_predicted_breakout && matchesBrandFilter(v, focusBrandForBreakout)
    ) ??
    filteredBreakouts.find((v) => v.is_predicted_breakout) ??
    filteredBreakouts[0];

  const fatiguedAds = fatigueList.filter((f) => f.is_fatigued);
  const fatiguedSpend = fatiguedAds.reduce((acc, f) => acc + f.spend_usd, 0);
  const topFatigued = fatiguedAds[0] ?? fatigueList[0];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">2. Market Share, Creative Themes &amp; Wearout</h1>
          <p className="page-subtitle">
            Benchmark <strong>{myBrand} (My Brand)</strong> against EU automotive competitors on spend vs. voice share, messaging whitespace, creative wearout, and organic YouTube velocity.
          </p>
        </div>

        <form className="form-row" onSubmit={(e) => e.preventDefault()}>
          <div className="field">
            <label htmlFor="themes-country">Market</label>
            <select
              id="themes-country"
              name="country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="themes-brand">Brand Filter</label>
            <select
              id="themes-brand"
              name="brand_id"
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
            >
              {BRAND_FILTERS.map((b) => (
                <option key={b || "all"} value={b}>
                  {!b
                    ? "All EU Auto Brands (My Brand vs. Competitors)"
                    : `${b} (${b === myBrand ? "My Brand" : "Competitor"})`}
                </option>
              ))}
            </select>
          </div>
        </form>
      </div>

      {error && (
        <div role="alert" className="banner banner-danger">
          <span aria-hidden="true">!</span>
          <span>Failed to load market &amp; theme data: {error}</span>
        </div>
      )}

      {loading && <p role="status">Loading market share, creative themes, and YouTube momentum...</p>}

      {data && sos && tf && (
        <>
          <section className="kpi-grid" aria-label="Market & Theme KPIs">
            <article className="kpi-card">
              <p className="kpi-label">Total Market Ad Spend</p>
              <p className="kpi-value">{fmtUsd(sos.total_spend_usd)}</p>
              <p className="kpi-note">{fmtCompact(sos.total_impressions)} paid impressions</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">Human-Verified Ad Accuracy</p>
              <p className="kpi-value">{sos.audit_coverage_pct.toFixed(1)}%</p>
              <p className="kpi-note">
                <Link href="/creatives">Inspect &amp; correct tags in Step 3 &rarr;</Link>
              </p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">Messaging Competition</p>
              <p className="kpi-value">{tf.hhi_concentration || "Competitive"}</p>
              <p className="kpi-note">{themesList.length} active creative themes across brands</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">Ads Needing Refresh (&ge;8w)</p>
              <p className="kpi-value">{fatiguedAds.length}</p>
              <p className="kpi-note">Out of {fatigueList.length} top monitored ads</p>
            </article>
          </section>

          <section className="panel" aria-labelledby="decision-brief-heading">
            <h2 id="decision-brief-heading" className="panel-title">
              Recommended Next Actions (Decision Brief for {myBrand})
            </h2>
            <div className="card-grid">
              <article className="kpi-card">
                <p className="kpi-label">1. Paid Efficiency Diagnosis</p>
                <p style={{ marginBlockStart: "0.35rem", marginBlockEnd: "0.65rem", fontSize: "0.92rem" }}>
                  {!brandId ? (
                    myBrandRow ? (
                      <>
                        <strong>All-Brands Market View:</strong>{" "}
                        <strong>{myBrand} (My Brand)</strong> captures{" "}
                        <strong>{myBrandRow.sov_pct.toFixed(1)}%</strong> voice share vs.{" "}
                        <strong>{myBrandRow.sos_pct.toFixed(1)}%</strong> spend share (
                        <strong>
                          {myVoiceGap >= 0 ? "+" : ""}
                          {myVoiceGap.toFixed(1)} pts
                        </strong>{" "}
                        efficiency gap)
                        {topCompetitorRow ? (
                          <>
                            {" "}
                            against top competitor <strong>{topCompetitorRow.brand_id}</strong> (
                            <strong>{topCompetitorRow.sov_pct.toFixed(1)}%</strong> voice vs.{" "}
                            <strong>{topCompetitorRow.sos_pct.toFixed(1)}%</strong> spend in{" "}
                            {sos.country_name})
                          </>
                        ) : (
                          ` in ${sos.country_name}`
                        )}
                        .
                      </>
                    ) : (
                      `No ${myBrand} share metrics available for ${sos.country_name}.`
                    )
                  ) : selectedBrandRow ? (
                    selectedBrandRow.brand_id === myBrand ? (
                      <>
                        <strong>{selectedBrandRow.brand_id} (My Brand)</strong> captures{" "}
                        <strong>{selectedBrandRow.sov_pct.toFixed(1)}%</strong> voice share vs.{" "}
                        <strong>{selectedBrandRow.sos_pct.toFixed(1)}%</strong> spend share (
                        <strong>
                          {selectedGap >= 0 ? "+" : ""}
                          {selectedGap.toFixed(1)} pts
                        </strong>{" "}
                        efficiency gap in {sos.country_name}).
                      </>
                    ) : (
                      <>
                        <strong>{selectedBrandRow.brand_id} (Competitor)</strong> captures{" "}
                        <strong>{selectedBrandRow.sov_pct.toFixed(1)}%</strong> voice share vs.{" "}
                        <strong>{selectedBrandRow.sos_pct.toFixed(1)}%</strong> spend share (
                        <strong>
                          {selectedGap >= 0 ? "+" : ""}
                          {selectedGap.toFixed(1)} pts
                        </strong>{" "}
                        gap)
                        {myBrandRow
                          ? ` compared with ${myBrand} (My Brand) at ${myBrandRow.sov_pct.toFixed(1)}% voice share`
                          : ""}{" "}
                        in {sos.country_name}.
                      </>
                    )
                  ) : (
                    "No brand share metrics available for this filter."
                  )}
                </p>
                <Link href="/mmm" className="btn">
                  Reallocate {myBrand} Budget in Step 4 &rarr;
                </Link>
              </article>

              <article className="kpi-card">
                <p className="kpi-label">2. Creative Whitespace &amp; Organic Hook</p>
                <p style={{ marginBlockStart: "0.35rem", marginBlockEnd: "0.65rem", fontSize: "0.92rem" }}>
                  {whitespaceTheme ? (
                    <>
                      <strong>{whitespaceTheme.theme_label}</strong> (
                      {whitespaceTheme.scope === "brand_exclusive_whitespace"
                        ? "Uncontested Angle"
                        : "Top Active Theme"}
                      , {whitespaceTheme.share_pct.toFixed(1)}% category spend).
                    </>
                  ) : (
                    "No creative themes loaded."
                  )}
                  {matchingBreakout && (
                    <>
                      {" "}
                      Organic breakout on <strong>{matchingBreakout.channel_title}</strong>:{" "}
                      &ldquo;{matchingBreakout.title}&rdquo; (
                      {(matchingBreakout.breakout_prob * 100).toFixed(0)}% breakout likelihood).
                    </>
                  )}
                </p>
                <Link
                  href={`/creatives${brandId ? `?brand_id=${encodeURIComponent(brandId)}` : ""}`}
                  className="btn"
                >
                  Inspect Creative Hooks in Step 3 &rarr;
                </Link>
              </article>

              <article className="kpi-card">
                <p className="kpi-label">3. Urgent Creative Refresh Queue</p>
                <p style={{ marginBlockStart: "0.35rem", marginBlockEnd: "0.65rem", fontSize: "0.92rem" }}>
                  <strong>{fatiguedAds.length}</strong> ads show severe wearout (&ge;8w active, &le;55%
                  of peak impressions) representing <strong>{fmtUsd(fatiguedSpend)}</strong> in
                  tracked spend.
                </p>
                <Link
                  href={
                    topFatigued
                      ? `/creatives?asset_id=${encodeURIComponent(
                          topFatigued.asset_id
                        )}&brand_id=${encodeURIComponent(
                          topFatigued.focal_brand_id || topFatigued.brand_id
                        )}`
                      : "/creatives"
                  }
                  className="btn btn-primary"
                >
                  Review Top Worn-Out Ad (
                  {topFatigued ? `#${topFatigued.short_asset_id || topFatigued.asset_id}` : "Queue"}
                  ) &rarr;
                </Link>
              </article>
            </div>
          </section>

          <section className="panel" aria-labelledby="sos-table-heading">
            <div className="page-header" style={{ marginBlockEnd: "0.75rem" }}>
              <div>
                <h2 id="sos-table-heading" className="panel-title" style={{ margin: 0 }}>
                  Brand Share of Spend vs. Share of Voice ({sos.country_name})
                </h2>
                <p className="kpi-note" style={{ marginBlockStart: "0.2rem" }}>
                  Comparing <strong>{myBrand} (My Brand)</strong> against competitors
                  {brandId ? ` · lower theme, wearout, and YouTube tables filtered to ${brandId}.` : "."}
                </p>
              </div>
              <Link href="/mmm" className="btn">
                Plan {myBrand} Budget in Step 4 &rarr;
              </Link>
            </div>
            <div tabIndex={0} role="region" aria-labelledby="sos-table-heading" className="table-wrapper responsive-stack">
              <table>
                <caption>{sos.country_name} brand share of spend, voice, and human verification coverage</caption>
                <thead>
                  <tr>
                    <th scope="col">Brand</th>
                    <th scope="col">Ad Spend</th>
                    <th scope="col">Spend Share</th>
                    <th scope="col">Impressions</th>
                    <th scope="col">Voice Share</th>
                    <th scope="col">Verified %</th>
                    <th scope="col">Manual Corrections</th>
                  </tr>
                </thead>
                <tbody>
                  {sos.brands.map((b) => {
                    const isMyBrand = b.brand_id === myBrand;
                    const isFiltered = Boolean(brandId && b.brand_id === brandId);
                    const rowBg = isMyBrand || isFiltered ? "rgba(37, 99, 235, 0.10)" : undefined;
                    return (
                      <tr key={b.brand_id} style={rowBg ? { background: rowBg } : undefined}>
                        <th scope="row" style={rowBg ? { background: "var(--surface-alt)" } : undefined}>
                          {b.brand_id}
                          <span
                            className={`badge ${isMyBrand ? "badge-ok" : ""}`}
                            style={{ marginInlineStart: "0.45rem" }}
                          >
                            {isMyBrand ? "My Brand" : "Competitor"}
                          </span>
                          {isFiltered && !isMyBrand && (
                            <span className="badge badge-warn" style={{ marginInlineStart: "0.35rem" }}>
                              Filtered
                            </span>
                          )}
                        </th>
                        <td data-label="Ad Spend">{fmtUsd(b.total_spend_usd)}</td>
                        <td data-label="Spend Share">{b.sos_pct.toFixed(2)}%</td>
                        <td data-label="Impressions">{fmtCompact(b.total_impressions)}</td>
                        <td data-label="Voice Share">{b.sov_pct.toFixed(2)}%</td>
                        <td data-label="Verified %">{b.audit_coverage_pct.toFixed(1)}%</td>
                        <td data-label="Manual Corrections">{b.overridden_assets}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="card-grid">
            <section className="panel" aria-labelledby="battleground-heading">
              <h2 id="battleground-heading" className="panel-title">
                Crowded Topics vs. Uncontested Whitespace
              </h2>
              <div tabIndex={0} role="region" aria-labelledby="battleground-heading" className="table-wrapper">
                <table>
                  <caption>Active creative messaging themes ordered by ad spend</caption>
                  <thead>
                    <tr>
                      <th scope="col">Theme</th>
                      <th scope="col">Positioning</th>
                      <th scope="col">{myBrand} Stance</th>
                      <th scope="col">Brands Active</th>
                      <th scope="col">Ad Spend</th>
                      <th scope="col">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {themesList.map((t) => {
                      const myBrandActive = t.brands.includes(myBrand);
                      return (
                        <tr key={t.theme_id}>
                          <th scope="row">{t.theme_label}</th>
                          <td>
                            <span className={`badge ${t.scope === "brand_exclusive_whitespace" ? "badge-ok" : "badge-warn"}`}>
                              {t.scope === "brand_exclusive_whitespace" ? "Uncontested Angle" : "Crowded Topic"}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${myBrandActive ? "badge-ok" : "badge-warn"}`}>
                              {myBrandActive ? "My Brand Active" : "Competitor Only"}
                            </span>
                          </td>
                          <td>{t.brands.join(", ")}</td>
                          <td>{fmtUsd(t.spend_usd)}</td>
                          <td>{t.share_pct.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel" aria-labelledby="umap-heading">
              <h2 id="umap-heading" className="panel-title">
                Creative Messaging Map ({scatterPoints.length} ads)
              </h2>
              <ThemeScatterSvg points={scatterPoints} />
            </section>
          </div>

          <section className="panel" aria-labelledby="fatigue-heading">
            <h2 id="fatigue-heading" className="panel-title">
              Creative Wearout &amp; Refresh Queue ({fatigueList.length} monitored ads)
            </h2>
            <p className="kpi-note" style={{ marginBlockEnd: "0.75rem" }}>
              Ads running 8+ weeks whose recent weekly impressions dropped by &ge;45% vs peak are flagged for creative refresh in Step 3.
            </p>
            <div tabIndex={0} role="region" aria-labelledby="fatigue-heading" className="table-wrapper responsive-stack">
              <table>
                <caption>Top monitored ads ranked by wearout severity and ad spend</caption>
                <thead>
                  <tr>
                    <th scope="col">Ad ID</th>
                    <th scope="col">Brand &amp; Channel</th>
                    <th scope="col">Theme</th>
                    <th scope="col" style={{ whiteSpace: "nowrap" }}>Active Span</th>
                    <th scope="col">Recent vs. Peak Impressions</th>
                    <th scope="col">Status</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {fatigueList.map((f) => {
                    const decayPct = ((f.impression_decay_ratio ?? Math.max(0, 1 - f.wearout_score)) * 100).toFixed(0);
                    const focalBrand = f.focal_brand_id || f.brand_id;
                    const isMyBrandAd = focalBrand === myBrand;
                    return (
                      <tr key={`${f.asset_id}-${focalBrand}-${f.channel_group}`}>
                        <th scope="row">
                          <span className="id-pill" title={f.asset_id}>
                            #{f.short_asset_id || f.asset_id}
                          </span>
                        </th>
                        <td data-label="Brand & Channel">
                          <strong>{focalBrand}</strong>{" "}
                          <span className={`badge ${isMyBrandAd ? "badge-ok" : ""}`}>
                            {isMyBrandAd ? "My Brand" : "Competitor"}
                          </span>{" "}
                          &middot; {f.channel_group}
                        </td>
                        <td data-label="Theme">{f.theme_label || "Unclustered"}</td>
                        <td data-label="Active Span">
                          {f.span_weeks ?? f.active_weeks}w span ({f.active_weeks}w live)
                        </td>
                        <td data-label="Impression Decay">
                          <strong>{decayPct}% of peak</strong>
                          {f.peak_weekly_impressions !== undefined && f.recent_weekly_impressions !== undefined && (
                            <span className="kpi-note" style={{ display: "block", margin: 0 }}>
                              {fmtCompact(f.recent_weekly_impressions)} recent / {fmtCompact(f.peak_weekly_impressions)} peak
                            </span>
                          )}
                        </td>
                        <td data-label="Status">
                          <span className={`badge ${f.is_fatigued ? "badge-danger" : "badge-ok"}`}>
                            {f.is_fatigued ? "Refresh Needed" : "Healthy"}
                          </span>
                        </td>
                        <td data-label="Action">
                          <Link
                            href={`/creatives?asset_id=${encodeURIComponent(
                              f.asset_id
                            )}&brand_id=${encodeURIComponent(focalBrand)}`}
                            className="btn"
                          >
                            Review Ad &rarr;
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {velocity && (
            <section id="youtube-momentum" className="panel" aria-labelledby="yt-momentum-heading">
              <div className="page-header" style={{ marginBlockEnd: "0.75rem" }}>
                <div>
                  <h2 id="yt-momentum-heading" className="panel-title" style={{ margin: 0 }}>
                    EU Automotive Organic YouTube Breakout Momentum ({predictedBreakoutCount} breakouts{brandId ? ` \u00b7 ${brandId}` : ""})
                  </h2>
                  <p className="kpi-note" style={{ marginBlockStart: "0.2rem" }}>
                    Organic brand-channel video velocity vs. each channel&apos;s own 30-day average — useful context alongside paid themes.
                  </p>
                </div>
                <Link href="/velocity" className="btn">
                  Open System Health &amp; Drift &rarr;
                </Link>
              </div>
              <div tabIndex={0} role="region" aria-labelledby="yt-momentum-heading" className="table-wrapper responsive-stack">
                <table>
                  <caption>Latest EU Automotive YouTube uploads ranked by breakout probability</caption>
                  <thead>
                    <tr>
                      <th scope="col">Channel</th>
                      <th scope="col">Video Title</th>
                      <th scope="col">Format</th>
                      <th scope="col">Breakout Likelihood</th>
                      <th scope="col">7d Upload Pace</th>
                      <th scope="col">30d Avg Views</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBreakouts.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          No organic YouTube videos found for {brandId || "the active filter"}.
                        </td>
                      </tr>
                    ) : (
                      filteredBreakouts.map((v) => {
                        const isMyBrandChannel = matchesBrandFilter(v, myBrand);
                        return (
                          <tr key={v.video_id}>
                            <th scope="row">
                              {v.channel_title}{" "}
                              <span className={`badge ${isMyBrandChannel ? "badge-ok" : ""}`}>
                                {isMyBrandChannel ? "My Brand" : "Competitor"}
                              </span>
                            </th>
                            <td data-label="Video Title">{v.title || v.video_id}</td>
                            <td data-label="Format">{v.is_short ? "Short" : "Long-form"}</td>
                            <td data-label="Breakout Likelihood">
                              <span className={`badge ${v.is_predicted_breakout ? "badge-warn" : ""}`}>
                                {(v.breakout_prob * 100).toFixed(0)}% {v.is_predicted_breakout ? "Breakout" : "Steady"}
                              </span>
                            </td>
                            <td data-label="7d Upload Pace">{v.channel_upload_blitz_7d} uploads</td>
                            <td data-label="30d Avg Views">{fmtCompact(v.channel_historical_avg_views_30d)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <details className="panel diag-drawer">
            <summary>
              Technical Clustering &amp; Overlap Diagnostics (HHI {categoryHhi.toFixed(0)} &amp; Jaccard Brand Similarity)
            </summary>
            <p className="kpi-note" style={{ marginBlockEnd: "0.75rem" }}>
              Herfindahl-Hirschman Index (HHI = {categoryHhi.toFixed(1)}, {tf.hhi_concentration || "Competitive"}) measures how heavily ad budgets concentrate into a few themes; Jaccard overlap measures shared theme sets between competitor pairs.
            </p>
            <div tabIndex={0} role="region" aria-label="Brand Theme Overlap Matrix" className="table-wrapper">
              <table>
                <caption>Pairwise brand creative theme overlap (Jaccard similarity)</caption>
                <thead>
                  <tr>
                    <th scope="col">Brand Pair</th>
                    <th scope="col">Similarity</th>
                    <th scope="col">Shared Themes</th>
                  </tr>
                </thead>
                <tbody>
                  {jaccardList.map((pair) => (
                    <tr key={`${pair.brand_a}-${pair.brand_b}`}>
                      <th scope="row">{pair.brand_a} &harr; {pair.brand_b}</th>
                      <td>{pair.jaccard_similarity.toFixed(3)}</td>
                      <td>{pair.shared_themes.join(", ") || "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </>
  );
}

function ThemeScatterSvg({ points }: { points: PortalThemesResponse["themes_and_fatigue"]["scatter_points"] }) {
  if (!points.length) {
    return <p className="page-subtitle">No 2D creative cluster coordinates available for the active filter.</p>;
  }

  const coords = points.map((p, idx) => ({
    x: Number(p.umap_x ?? p.x ?? (idx % 7) - 3),
    y: Number(p.umap_y ?? p.y ?? Math.floor(idx / 7) - 2),
    brand: p.brand_id_raw || "Unknown",
    label: p.theme_label || p.theme_id || "Cluster",
  }));

  const xs = coords.map((c) => c.x);
  const ys = coords.map((c) => c.y);
  const minX = Math.min(...xs) - 0.5;
  const maxX = Math.max(...xs) + 0.5;
  const minY = Math.min(...ys) - 0.5;
  const maxY = Math.max(...ys) + 0.5;
  const spanX = Math.max(1e-3, maxX - minX);
  const spanY = Math.max(1e-3, maxY - minY);

  const left = 58;
  const right = 594;
  const top = 20;
  const bottom = 308;
  const width = right - left;
  const height = bottom - top;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const seenCounts = new Map<string, number>();

  const brandColors: Record<string, string> = {
    BMW: "#2563eb",
    "Mercedes-Benz": "#0d9488",
    Audi: "#dc2626",
    Porsche: "#d97706",
  };

  return (
    <figure style={{ margin: 0 }}>
      <svg
        role="img"
        aria-label="Creative Messaging Map scatter plot with labeled axes showing BMW, Mercedes-Benz, Audi, and Porsche ad clusters"
        viewBox="0 0 640 360"
        style={{
          inlineSize: "100%",
          blockSize: "auto",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          background: "var(--surface-alt)",
        }}
      >
        {/* Gridlines & Numeric Ticks */}
        {ticks.map((t) => {
          const gx = left + t * width;
          const gy = bottom - t * height;
          const xVal = (minX + t * spanX).toFixed(1);
          const yVal = (minY + t * spanY).toFixed(1);
          return (
            <g key={t}>
              <line x1={gx} y1={top} x2={gx} y2={bottom} stroke="var(--border)" strokeDasharray="3 4" strokeWidth="1" />
              <line x1={left} y1={gy} x2={right} y2={gy} stroke="var(--border)" strokeDasharray="3 4" strokeWidth="1" />
              <text x={gx} y={bottom + 16} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
                {xVal}
              </text>
              <text x={left - 8} y={gy + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
                {yVal}
              </text>
            </g>
          );
        })}

        {/* Primary Axes */}
        <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="var(--text-muted)" strokeWidth="1.5" />
        <line x1={left} y1={top} x2={left} y2={bottom} stroke="var(--text-muted)" strokeWidth="1.5" />

        {/* Axis Titles */}
        <text x={(left + right) / 2} y={350} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text)">
          Creative Angle Axis 1 (Visual &amp; Copy Similarity)
        </text>
        <text
          x={16}
          y={(top + bottom) / 2}
          textAnchor="middle"
          fontSize="12"
          fontWeight="600"
          fill="var(--text)"
          transform={`rotate(-90 16 ${(top + bottom) / 2})`}
        >
          Creative Style Axis 2 (Hook &amp; Pacing)
        </text>

        {coords.map((c, idx) => {
          const coordKey = `${c.x.toFixed(3)}:${c.y.toFixed(3)}`;
          const dupIdx = seenCounts.get(coordKey) ?? 0;
          seenCounts.set(coordKey, dupIdx + 1);
          let cx = left + ((c.x - minX) / spanX) * width;
          let cy = bottom - ((c.y - minY) / spanY) * height;
          if (dupIdx > 0) {
            const angle = dupIdx * 1.9;
            const radius = Math.min(10, dupIdx * 3.2);
            cx += Math.cos(angle) * radius;
            cy += Math.sin(angle) * radius;
          }
          const fill = brandColors[c.brand] || "#6366f1";
          return (
            <circle key={idx} cx={cx} cy={cy} r="6" fill={fill} stroke="var(--surface)" strokeWidth="1.2" opacity="0.88">
              <title>{`${c.brand} — ${c.label}`}</title>
            </circle>
          );
        })}
      </svg>
      <figcaption className="legend-row">
        {Object.entries(brandColors).map(([brand, hex]) => (
          <span key={brand} className="legend-item">
            <span className="legend-swatch" style={{ backgroundColor: hex }} aria-hidden="true" />
            <span>{brand}</span>
          </span>
        ))}
        <span>&middot; Dots close together share similar visuals &amp; ad copy. Hover any dot for its theme.</span>
      </figcaption>
    </figure>
  );
}
