import { siteSchema, type SiteConfig } from "./schema.ts";

/**
 * ✏️ Brand, colours and SEO for OmniSuite. Everything here is validated by `siteSchema`.
 * OmniSuite is server-only (ADR 0008). The public URL comes from APP_URL / NEXT_PUBLIC_SITE_URL.
 */
const site: SiteConfig = {
  name: "OmniSuite",
  shortName: "OmniSuite",
  description:
    "Run your business in one place: partners and profit, money, clients, proposals, invoices and projects.",
  url: "https://app.omniscopedigital.com",
  locale: "en",
  dir: "ltr",
  render: "server",
  theme: {
    defaultMode: "system",
    // Brand colour, gradients and chart colours: src/config/themes.ts.
    preset: "violet",
    background: { light: "#f5f7fa", dark: "#0f1117" },
    radius: "0.75rem",
    sidebar: "light",
    surface: "tinted",
  },
  contact: {
    email: "omniscope.digital@gmail.com",
  },
  socials: [],
  seo: {
    title: "OmniSuite",
    keywords: ["business management", "profit sharing", "invoices", "client portal"],
  },
};

export const siteConfig = siteSchema.parse(site);
