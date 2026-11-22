"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Layers,
  Menu,
  MessageSquareText,
  Moon,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react";
import { usePortal, type RoutePath } from "@/context/PortalContext";
import { BRAND_CATALOG, BRAND_LIST, type BrandId } from "@/lib/types";

interface NavItem {
  path: RoutePath;
  step?: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

const WORKFLOW_NAV: NavItem[] = [
  {
    path: "/",
    step: "1",
    label: "1. Executive Copilot",
    shortLabel: "Executive Copilot",
    icon: MessageSquareText,
  },
  {
    path: "/themes",
    step: "2",
    label: "2. Market Share & Themes",
    shortLabel: "Market Share & Themes",
    icon: BarChart3,
  },
  {
    path: "/creatives",
    step: "3",
    label: "3. Ad Creative Review",
    shortLabel: "Ad Creative Review",
    icon: Layers,
  },
  {
    path: "/mmm",
    step: "4",
    label: "4. Budget & ROI Planner",
    shortLabel: "Budget & ROI Planner",
    icon: SlidersHorizontal,
  },
];

const UTILITY_NAV: NavItem = {
  path: "/velocity",
  label: "System Health",
  shortLabel: "System Health",
  icon: Activity,
};

function getPageTitle(path: RoutePath): string {
  if (path === "/velocity") return UTILITY_NAV.shortLabel;
  return (
    WORKFLOW_NAV.find((n) => n.path === path)?.shortLabel ?? "Executive Copilot"
  );
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const {
    myBrandId,
    setMyBrandId,
    theme,
    toggleTheme,
    sidebarCollapsed,
    setSidebarCollapsed,
    routePath,
    isStreaming,
    streamingBrandId,
  } = usePortal();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const activeTitle = getPageTitle(routePath);

  const renderSidebarContent = (isMobile = false) => {
    const compact = !isMobile && sidebarCollapsed;
    return (
      <div className="flex h-full flex-col justify-between bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800">
        <div>
          {/* Brand lockup */}
          <div className="flex h-14 items-center justify-between px-4 border-b border-zinc-200 dark:border-zinc-800">
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded-md"
              aria-label="Creative Intel Suite Home"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-xs font-semibold tracking-tight text-white dark:bg-zinc-100 dark:text-zinc-950">
                CI
              </span>
              {!compact && (
                <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                  Creative Intel Suite
                </span>
              )}
            </Link>

            {isMobile ? (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-md"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
                className="hidden lg:inline-flex p-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-900 rounded-md transition-colors"
              >
                {compact ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronLeft className="h-4 w-4" />
                )}
              </button>
            )}
          </div>

          {/* 4-Step Workflow */}
          <nav aria-label="Primary workflow" className="p-3 space-y-1">
            {!compact && (
              <div className="px-2.5 pt-1 pb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Intelligence Workflow
              </div>
            )}
            {WORKFLOW_NAV.map((item) => {
              const Icon = item.icon;
              const isActive = routePath === item.path;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  title={compact ? item.label : undefined}
                  className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                  } ${compact ? "justify-center px-0" : ""}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!compact && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Separated bottom System Health utility */}
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
          {!compact && (
            <div className="px-2.5 pb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Platform Ops
            </div>
          )}
          <Link
            href={UTILITY_NAV.path}
            onClick={() => setMobileMenuOpen(false)}
            aria-current={routePath === UTILITY_NAV.path ? "page" : undefined}
            title={compact ? UTILITY_NAV.label : undefined}
            className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
              routePath === UTILITY_NAV.path
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            } ${compact ? "justify-center px-0" : ""}`}
          >
            <Activity className="h-4 w-4 shrink-0" />
            {!compact && <span>{UTILITY_NAV.label}</span>}
          </Link>
          {!compact && (
            <div className="mt-3 px-2.5 text-xs text-zinc-500 dark:text-zinc-400">
              EU Auto · DE / UK / FR
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-zinc-900 focus:px-3 focus:py-2 focus:text-xs focus:font-medium focus:text-white dark:focus:bg-zinc-100 dark:focus:text-zinc-950"
      >
        Skip to main content
      </a>

      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 sticky top-0 h-screen transition-[width] duration-200 ${
          sidebarCollapsed ? "w-[68px]" : "w-[252px]"
        }`}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-zinc-950/50 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-[264px] max-w-[82vw] h-full">
            {renderSidebarContent(true)}
          </div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Sticky Top Utility Bar */}
        <header className="sticky top-0 z-30 h-14 bg-white/95 dark:bg-zinc-950/95 backdrop-blur border-b border-zinc-200 dark:border-zinc-800 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-1.5 -ml-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-md"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                Creative Intel Suite
              </span>
              <span
                className="hidden sm:inline text-zinc-300 dark:text-zinc-700"
                aria-hidden="true"
              >
                /
              </span>
              <h1 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {activeTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Live Background Copilot Streaming Indicator */}
            {isStreaming && (
              <Link
                href="/"
                data-testid="copilot-streaming-pill"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-950 transition-colors whitespace-nowrap shrink-0"
              >
                <span
                  className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
                  aria-hidden="true"
                />
                <span>
                  Copilot Streaming...
                  {streamingBrandId && routePath !== "/"
                    ? ` (${BRAND_CATALOG[streamingBrandId].shortName})`
                    : ""}
                </span>
              </Link>
            )}

            {/* Global My Brand (1st-Party) Selector */}
            <div className="flex items-center gap-2">
              <label
                htmlFor="global-my-brand-select"
                className="hidden md:inline text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap"
              >
                My Brand (1st-Party)
              </label>
              <select
                id="global-my-brand-select"
                aria-label="My Brand (1st-Party)"
                value={myBrandId}
                onChange={(e) => setMyBrandId(e.target.value as BrandId)}
                className="h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 cursor-pointer"
              >
                {BRAND_LIST.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Light / Dark Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={
                theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
              }
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors shrink-0"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="sr-only">
                {theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              </span>
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px] w-full mx-auto"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
