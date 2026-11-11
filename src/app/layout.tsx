import type { Metadata, Viewport } from "next";
import { ThemeScript } from "@/components/layout/theme-script";
import { Toaster } from "@/components/ui/sonner";
import { features, isProduction, site } from "@/config";
import { fontVariables } from "@/config/fonts";
import { InstallCard, OfflineBanner, PwaScript } from "@/features/pwa";
import { locale, t } from "@/i18n";
import { platformThemeVariables, themeCss } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.seo.title, template: `%s · ${site.name}` },
  description: site.description,
  keywords: site.seo.keywords,
  applicationName: site.name,
  openGraph: { type: "website", siteName: site.name, title: site.seo.title, description: site.description },
  twitter: { card: "summary_large_image", title: site.seo.title, description: site.description },
  // Icons and the manifest are generated from config by scripts/generate-assets.ts.
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  ...(features.pwa ? { manifest: "/manifest.webmanifest" } : {}),
  appleWebApp: { capable: features.pwa, title: site.shortName, statusBarStyle: "default" },
};

const { background } = site.theme;
export const viewport: Viewport = {
  themeColor:
    site.theme.defaultMode === "system"
      ? [
          { media: "(prefers-color-scheme: light)", color: background.light },
          { media: "(prefers-color-scheme: dark)", color: background.dark },
        ]
      : background[site.theme.defaultMode],
  viewportFit: "cover",
};

/** Theme values from config become CSS variables; globals.css maps them onto the design tokens. */
const platformCss = themeCss(":root", platformThemeVariables());

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang={locale}
      dir={site.dir}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${fontVariables} ${site.theme.defaultMode === "dark" ? "dark" : ""} h-full antialiased`}
    >
      <head>
        <style>{platformCss}</style>
        <ThemeScript />
        {features.pwa ? <PwaScript serviceWorker={isProduction} /> : null}
      </head>
      <body className="min-h-full bg-background text-foreground">
        <a
          href="#content"
          className="fixed top-3 left-3 z-[100] -translate-y-20 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:translate-y-0"
        >
          {t("a11y.skip")}
        </a>
        {children}
        <Toaster position="top-right" richColors />
        {features.offlineBanner ? <OfflineBanner /> : null}
        {features.pwa ? <InstallCard /> : null}
      </body>
    </html>
  );
}
