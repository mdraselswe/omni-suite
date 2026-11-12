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
        /** AI requests per day for a business on this plan (0 = AI off for the plan). */
        aiDailyRequests: z.number().int().min(0),
        highlighted: z.boolean().default(false),
      }),
    )
    .min(1),
});

export type BillingConfig = z.infer<typeof billingSchema>;

/** AI services the app can call. Each one's API key comes from env (src/config/env.ts). */
export const AI_PROVIDERS = ["anthropic", "openai-compatible"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

/** Features that call AI. Each can pick its own provider and model in src/config/ai.ts. */
export const AI_FEATURES = ["proposalDraft", "insights"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const modelId = z.string().trim().min(1);

export const aiSchema = z.object({
  /** Provider every feature uses unless `features` says otherwise. */
  defaultProvider: z.enum(AI_PROVIDERS),
  providers: z.object({
    /** Claude, through the official SDK. Key: ANTHROPIC_API_KEY. */
    anthropic: z.object({
      model: modelId,
      /** Thinking depth and token spend. */
      effort: z.enum(AI_EFFORTS),
      /** Only for a gateway or proxy in front of the Claude API; leave out for the real API. */
      baseUrl: z.url().optional(),
    }),
    /**
     * Any server with an OpenAI-style `POST <baseUrl>/chat/completions`: OpenAI, OpenRouter,
     * Groq, DeepSeek, Ollama, Gemini's OpenAI endpoint. Key: OPENAI_COMPATIBLE_API_KEY.
     */
    "openai-compatible": z.object({
      model: modelId,
      /** Base URL without a trailing slash and without /chat/completions. */
      baseUrl: z.url(),
      /**
       * How to ask for JSON: "json_schema" (strict schema, OpenAI/OpenRouter/Groq/Ollama),
       * "json_object" (any JSON, e.g. DeepSeek) or "none" (schema only in the instructions).
       */
      jsonMode: z.enum(["json_schema", "json_object", "none"]),
      /** Name of the answer-length field: OpenAI's newer models want "max_completion_tokens". */
      tokenLimitParam: z.enum(["max_tokens", "max_completion_tokens"]),
    }),
  }),
  /** Per-feature override: a different provider and/or model (e.g. a cheaper, faster one). */
  features: z.partialRecord(
    z.enum(AI_FEATURES),
    z.object({ provider: z.enum(AI_PROVIDERS).optional(), model: modelId.optional() }).strict(),
  ),
  /** Hard cap on one answer's length (tokens). */
  maxTokens: z.number().int().positive(),
  /** Give up on a request after this long (milliseconds). */
  timeoutMs: z.number().int().positive(),
  /**
   * AI requests each business may make per day (its own timezone) when billing is off
   * (self-hosted). With billing on, the plan's `aiDailyRequests` applies (src/config/billing.ts).
   */
  dailyRequestsPerBusiness: z.number().int().min(0),
  /** AI requests one member may make per day, whatever the business allowance. */
  dailyRequestsPerMember: z.number().int().min(0),
  /** Longest brief a member can type for a proposal draft. */
  briefMaxLength: z.number().int().positive(),
});

export type AiConfig = z.infer<typeof aiSchema>;

/** Exchange-rate sources for "Use today's rate". "off" hides the button. */
export const FX_PROVIDERS = ["open-er-api", "off"] as const;
export type FxProviderKey = (typeof FX_PROVIDERS)[number];

const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO 4217 code, e.g. AUD");

export const regionalSchema = z.object({
  /** Number & date formats a business can pick in Settings (BCP 47 tags). */
  locales: z.array(z.string().min(2)).min(1),
  /**
   * Best-guess currency for a time zone, used to prefill the new-business form.
   * A key ending in "/" matches every zone in that region (e.g. "Australia/").
   */
  timeZoneCurrency: z.record(z.string().min(1), currencyCode),
  fx: z.object({
    /** Default source; FX_PROVIDER in the environment overrides it. */
    provider: z.enum(FX_PROVIDERS),
    /** API root of open.er-api.com (free, no key). Only currency codes are sent. */
    openErApiUrl: z.url(),
    /** Link shown next to the rate, as the provider's terms require. */
    attributionUrl: z.url(),
    /** Keep a fetched rate table this long (server memory). */
    cacheHours: z.number().positive().max(48),
    /** Give up on the provider after this long; the user types the rate instead. */
    timeoutMs: z.number().int().positive(),
  }),
});

export type RegionalConfig = z.infer<typeof regionalSchema>;

export const listsSchema = z
  .object({
    /** Rows-per-page choices offered under every paginated list (ascending). */
    pageSizes: z.array(z.number().int().min(5).max(500)).min(1),
    /** Rows per page when the URL has no `size`. Must be one of `pageSizes`. */
    defaultPageSize: z.number().int(),
    /** Wait after the last keystroke before a search box updates the list (ms). */
    searchDebounceMs: z.number().int().min(0).max(2000),
    /** Longest search text used (longer input is cut). */
    searchMaxLength: z.number().int().min(10).max(500),
    /** Newest leads shown per column of the leads board; the list view shows them all, page by page. */
    boardColumnSize: z.number().int().min(5).max(500),
    /** Rows in the short lists on a detail page (e.g. a client's invoices) before "View all". */
    previewSize: z.number().int().min(1).max(100),
  })
  .refine((l) => l.pageSizes.includes(l.defaultPageSize), {
    message: "defaultPageSize must be one of pageSizes",
    path: ["defaultPageSize"],
  });

export type ListsConfig = z.infer<typeof listsSchema>;

/** Abuse limits: what one business (or one address) may do in a time window. */
export const limitsSchema = z.object({
  mail: z.object({
    /** Emails one business may queue per hour (invitations, invoices, proposals, notifications). */
    perBusinessPerHour: z.number().int().positive(),
    /** Emails one business may queue per day (UTC). */
    perBusinessPerDay: z.number().int().positive(),
    /** Account emails (password reset, verification) one address may receive per hour. */
    perRecipientPerHour: z.number().int().positive(),
  }),
  storage: z.object({
    /** Total size of all uploaded files one business may keep, in megabytes. */
    perBusinessMb: z.number().int().positive(),
  }),
  signIn: z.object({
    /** Password sign-in attempts per email address per window (on top of Better Auth's per-IP limit). */
    perEmailMax: z.number().int().positive(),
    perEmailWindowMinutes: z.number().int().positive(),
  }),
});

export type LimitsConfig = z.infer<typeof limitsSchema>;
