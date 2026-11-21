import type { Metadata } from "next";
import { PortalNav } from "@/components/PortalNav";
import { PortalProvider } from "@/components/PortalProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Command Copilot | Creative Intel Suite",
    template: "%s | Creative Intel Suite",
  },
  description:
    "Federated Brand & Creative Intelligence Suite uniting SOS/SOV, dynamic creative themes, Vision HITL verification, Bayesian MMM, and breakout velocity monitoring.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="color-scheme" content="light dark" />
      </head>
      <body>
        <a href="#main-content" className="skip-link visually-hidden">
          Skip to main content
        </a>
        <PortalProvider>
          <PortalNav />
          <main id="main-content" tabIndex={-1} className="page-shell">
            {children}
          </main>
        </PortalProvider>
      </body>
    </html>
  );
}
