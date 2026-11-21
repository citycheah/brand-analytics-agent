"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EU_AUTO_BRANDS, EuAutoBrand, usePortalContext } from "@/components/PortalProvider";

const NAV_ITEMS = [
  { href: "/", label: "1. Executive Copilot" },
  { href: "/themes", label: "2. Market Share & Themes" },
  { href: "/creatives", label: "3. Ad Creative Review" },
  { href: "/mmm", label: "4. Budget & ROI Planner" },
];

export function PortalNav() {
  const pathname = usePathname();
  const isHealthCurrent = pathname?.startsWith("/velocity");
  const { myBrand, setMyBrand, streaming } = usePortalContext();

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="site-logo">
          <svg
            aria-hidden="true"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 17.5h7M17.5 14v7" />
          </svg>
          <span>Creative Intel Suite</span>
        </Link>

        <nav aria-label="Primary">
          <ul className="site-menu">
            {NAV_ITEMS.map((item) => {
              const isCurrent =
                item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="nav-link"
                    aria-current={isCurrent ? "page" : undefined}
                  >
                    {item.label}
                    {item.href === "/" && streaming && (
                      <span className="badge badge-ok" style={{ marginInlineStart: "0.35rem" }}>
                        Streaming...
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
            <li>
              <Link
                href="/velocity"
                className="nav-link nav-utility"
                aria-current={isHealthCurrent ? "page" : undefined}
              >
                System Health
              </Link>
            </li>
          </ul>
        </nav>

        <div className="form-row" style={{ alignItems: "center", gap: "0.45rem" }}>
          <label
            htmlFor="global-my-brand"
            style={{ fontSize: "0.84rem", fontWeight: 600, whiteSpace: "nowrap" }}
          >
            My Brand (1st-Party):
          </label>
          <select
            id="global-my-brand"
            name="my_brand"
            value={myBrand}
            onChange={(e) => setMyBrand(e.target.value as EuAutoBrand)}
            style={{ padding: "0.35rem 0.6rem" }}
          >
            {EU_AUTO_BRANDS.map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}
