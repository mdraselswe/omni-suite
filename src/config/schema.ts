import { z } from "zod";

/**
 * Schemas for every project-specific value. Config files are validated at
 * build time, so a typo fails the build instead of shipping.
 *
 * This file and the other files in src/config use only relative imports with
 * `.ts` extensions, so Node can run them directly in scripts/ (type stripping).
 */

export const RENDER_MODES = ["static", "server"] as const;
export type RenderMode = (typeof RENDER_MODES)[number];

export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Colour presets in src/config/themes.ts. A business can pick one in Settings → Branding. */
export const THEME_PRESETS = ["violet", "ocean", "emerald", "sunset", "rose", "graphite"] as const;
export type ThemePresetKey = (typeof THEME_PRESETS)[number];

/** Sidebar look: white, dark, or filled with the brand colour. */
export const SIDEBAR_STYLES = ["light", "dark", "brand"] as const;
export type SidebarStyle = (typeof SIDEBAR_STYLES)[number];

/** Card depth: brand-tinted shadow, neutral shadow, or flat with a border. */
export const SURFACE_STYLES = ["tinted", "soft", "flat"] as const;
export type SurfaceStyle = (typeof SURFACE_STYLES)[number];

export const SOCIAL_KINDS = [
  "facebook",
  "instagram",
  "x",
  "linkedin",
  "youtube",
  "tiktok",
  "github",
  "whatsapp",
] as const;

const color = z.string().regex(/^(oklch|#|rgb|hsl)/, "Use an oklch(), hex, rgb() or hsl() colour");

export const siteSchema = z.object({
  /** Full brand name, used in titles and the footer. */
  name: z.string().min(1),
  /** Short name for the app icon label (≤ 12 characters reads best). */
  shortName: z.string().min(1).max(20),
  description: z.string().min(1),
  /** Production URL without a trailing slash. Can be overridden with NEXT_PUBLIC_SITE_URL. */
  url: z.url(),
  /** BCP 47 language tag of the default locale, e.g. "en" or "bn". */
  locale: z.string().min(2),
  dir: z.enum(["ltr", "rtl"]),
  /**
   * How the site is built:
   * - "static": plain HTML files in out/, host anywhere (no server features)
   * - "server": full Next.js (Server Actions, route handlers, Cache Components)
   * Can be overridden with RENDER_MODE. Switch with `pnpm mode static|server`.
   */
  render: z.enum(RENDER_MODES),
  /** DNS label businesses add a TXT record under to prove they own a custom domain (`<label>.<their domain>`). */
  domainVerifyLabel: z.string().regex(/^_[a-z0-9-]{1,40}$/),
  theme: z.object({
    defaultMode: z.enum(THEME_MODES),
    /** Colour preset (src/config/themes.ts): brand colour, gradients and chart colours. */
    preset: z.enum(THEME_PRESETS),
    /** Page background behind the cards, per theme. Also used for the browser UI. */
    background: z.object({ light: color, dark: color }),
    /** Base corner radius, e.g. "0.75rem". Cards use it; smaller parts scale from it. */
    radius: z.string().regex(/^\d*\.?\d+(rem|px)$/),
    sidebar: z.enum(SIDEBAR_STYLES),
    surface: z.enum(SURFACE_STYLES),
  }),
  contact: z.object({
    email: z.email().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
  }),
  socials: z.array(z.object({ kind: z.enum(SOCIAL_KINDS), url: z.url() })),
  seo: z.object({
    /** Default page title (home page). */
    title: z.string().min(1),
    keywords: z.array(z.string()),
  }),
});

export type SiteConfig = z.infer<typeof siteSchema>;

export const featuresSchema = z.object({
  /** Light/dark switch in the header. */
  themeToggle: z.boolean(),
  /** Installable app: manifest, icons, service worker, offline support. */
  pwa: z.boolean(),
  /** "Install the app" card that pops up after a short visit (needs pwa). */
  installPrompt: z.object({
    enabled: z.boolean(),
    delaySeconds: z.number().int().min(0),
    /** Days to wait after "Not now" before showing it again. */
    snoozeDays: z.number().int().min(0),
  }),
  /** Small notice while the device is offline (needs pwa). */
  offlineBanner: z.boolean(),
});

export type FeaturesConfig = z.infer<typeof featuresSchema>;

export const PLAN_KEYS = ["starter", "growth", "scale"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const billingSchema = z.object({
  /** Stripe API version sent with every request (one known response shape). */
  stripeApiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}\.[a-z]+$/),
  /** Free days before the first charge, for a business that has never subscribed. */
  trialDays: z.number().int().min(0).max(90),
  plans: z
    .array(
      z.object({
        key: z.enum(PLAN_KEYS),
        /** Shown on the plan card. Must match the Stripe Price (env STRIPE_PRICE_<KEY>). */
        price: z.object({ amount: z.number().positive(), currency: z.string().length(3) }),
        /** Team members (internal) the plan allows; null = no limit. */
        maxMembers: z.number().int().positive().nullable(),
        highlighted: z.boolean().default(false),
      }),
    )
    .min(1),
});

export type BillingConfig = z.infer<typeof billingSchema>;
