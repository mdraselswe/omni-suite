import { buildEnv, publicEnv } from "./env.ts";
import { featuresConfig } from "./features.ts";
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

export const isProduction = buildEnv.NODE_ENV === "production";

export type { RenderMode, SidebarStyle, SurfaceStyle, ThemeMode, ThemePresetKey } from "./schema.ts";
export { SIDEBAR_STYLES, SURFACE_STYLES, THEME_MODES, THEME_PRESETS } from "./schema.ts";
export { themePresets, type Gradient, type ThemePreset } from "./themes.ts";
export { aiConfig } from "./ai.ts";
