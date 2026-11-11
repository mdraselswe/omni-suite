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
    primary: { light: "oklch(0.52 0.24 292)", dark: "oklch(0.76 0.14 290)" },
    primaryForeground: { light: "oklch(0.99 0.002 90)", dark: "oklch(0.2 0.03 285)" },
    background: { light: "#fbfaf8", dark: "#0b0b14" },
    radius: "0.5rem",
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
