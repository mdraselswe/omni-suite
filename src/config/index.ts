import { billingConfig } from "./billing.ts";
import { buildEnv, publicEnv } from "./env.ts";
import { featuresConfig } from "./features.ts";
import { limitsConfig } from "./limits.ts";
import { listsConfig } from "./lists.ts";
import { siteConfig } from "./site.ts";

/** Resolved configuration: config files plus environment overrides. Import from "@/config". */
export const site = {
  ...siteConfig,
  url: (publicEnv.NEXT_PUBLIC_SITE_URL ?? siteConfig.url).replace(/\/$/, ""),
  render: buildEnv.RENDER_MODE ?? siteConfig.render,
};

export const features = {
  ...featuresConfig,
  installPrompt: {
    ...featuresConfig.installPrompt,
    enabled: featuresConfig.pwa && featuresConfig.installPrompt.enabled,
  },
  offlineBanner: featuresConfig.pwa && featuresConfig.offlineBanner,
};

/** Platform subscription plans and Stripe settings. */
export const billing = billingConfig;

/** Abuse limits: mail quotas, storage quota, sign-in throttle. */
export const limits = limitsConfig;

/** Pagination and search defaults for every list. */
export const lists = listsConfig;

export const isProduction = buildEnv.NODE_ENV === "production";

export type {
  AiConfig,
  AiFeature,
  AiProviderId,
  BillingConfig,
  LimitsConfig,
  ListsConfig,
  PlanKey,
  RenderMode,
  SidebarStyle,
  SurfaceStyle,
  ThemeMode,
  ThemePresetKey,
} from "./schema.ts";
export {
  AI_FEATURES,
  AI_PROVIDERS,
  PLAN_KEYS,
  SIDEBAR_STYLES,
  SURFACE_STYLES,
  THEME_MODES,
  THEME_PRESETS,
} from "./schema.ts";
export { themePresets, type Gradient, type ThemePreset } from "./themes.ts";
export { aiConfig } from "./ai.ts";
export { regionalConfig } from "./regional.ts";
export { FX_PROVIDERS, type FxProviderKey, type RegionalConfig } from "./schema.ts";
