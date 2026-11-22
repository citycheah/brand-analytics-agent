import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { LayoutShell } from "@/components/LayoutShell";
import { PortalProvider } from "@/context/PortalContext";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Command Copilot | Creative Intel Suite",
    template: "%s | Creative Intel Suite",
  },
  description:
    "Federated Brand & Creative Intelligence Suite uniting SOS/SOV, dynamic creative themes, Vision HITL verification, Bayesian MMM, and breakout velocity monitoring.",
};

const FOUC_THEME_SCRIPT = `
try {
  var saved = localStorage.getItem("color-scheme");
  var isDark = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
} catch (e) {}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: FOUC_THEME_SCRIPT }} />
      </head>
      <body>
        <PortalProvider>
          <LayoutShell>{children}</LayoutShell>
        </PortalProvider>
      </body>
    </html>
  );
}
