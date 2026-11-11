import { site, themePresets, type SidebarStyle, type SurfaceStyle, type ThemePresetKey } from "@/config";

/** A #rrggbb colour (the only format a business can enter, so it is safe inside CSS). */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = "#ffffff";
const INK = "#14141f";

/** White or near-black text, whichever reads better on `hex`. */
export function readableText(hex: string): string {
  return contrastRatio(hex, WHITE) >= contrastRatio(hex, INK) ? WHITE : INK;
}

export type ThemeChoice = {
  preset: ThemePresetKey;
  /** Optional brand colour (#rrggbb) that replaces the preset's. */
  brandColor?: string;
  surface?: SurfaceStyle;
};

const SURFACE_SHADOW: Record<SurfaceStyle, string> = {
  tinted: "var(--shadow-tinted)",
  soft: "var(--shadow-soft)",
  flat: "none",
};

/** CSS variables for a theme choice; globals.css maps them onto the design tokens. */
export function themeVariables(choice: ThemeChoice): Record<string, string> {
  const preset = themePresets[choice.preset];
  const custom = choice.brandColor && HEX_COLOR.test(choice.brandColor) ? choice.brandColor : null;
  const vars: Record<string, string> = {
    "--brand": custom ?? preset.primary.light,
    "--brand-dark": custom ?? preset.primary.dark,
    "--brand-foreground": custom ? readableText(custom) : preset.primaryForeground.light,
    "--brand-foreground-dark": custom ? readableText(custom) : preset.primaryForeground.dark,
    "--brand-accent": preset.accent.light,
    "--brand-accent-dark": preset.accent.dark,
  };
  preset.gradients.forEach(([from, to], i) => {
    vars[`--gradient-${i + 1}-from`] = from;
    vars[`--gradient-${i + 1}-to`] = to;
  });
  if (choice.surface) {
    vars["--surface-shadow"] = SURFACE_SHADOW[choice.surface];
    vars["--surface-border"] = choice.surface === "flat" ? "var(--border)" : "transparent";
  }
  return vars;
}

/** The platform look from src/config/site.ts. */
export function platformThemeVariables(): Record<string, string> {
  const { theme } = site;
  return {
    ...themeVariables({ preset: theme.preset, surface: theme.surface }),
    "--page-bg": theme.background.light,
    "--page-bg-dark": theme.background.dark,
    "--radius": theme.radius,
  };
}

const SAFE_NAME = /^--[a-z0-9-]+$/;
const SAFE_VALUE = /^[#a-z0-9(). %,-]+$/i;

/** `selector { --a: b; … }` with every name and value checked, for a <style> tag. */
export function themeCss(selector: string, vars: Record<string, string>): string {
  const body = Object.entries(vars)
    .filter(([name, value]) => SAFE_NAME.test(name) && SAFE_VALUE.test(value))
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  return `${selector}{${body}}`;
}

/** Sidebar style and theme choice for a business, falling back to the platform defaults. */
export function tenantTheme(branding: { preset: string; brandColor: string; sidebar: string }): {
  vars: Record<string, string> | null;
  sidebar: SidebarStyle;
} {
  const preset = (
    Object.hasOwn(themePresets, branding.preset) ? branding.preset : null
  ) as ThemePresetKey | null;
  const brandColor = HEX_COLOR.test(branding.brandColor) ? branding.brandColor : "";
  const sidebar =
    (["light", "dark", "brand"] as const).find((s) => s === branding.sidebar) ?? site.theme.sidebar;
  const vars =
    preset || brandColor ? themeVariables({ preset: preset ?? site.theme.preset, brandColor }) : null;
  return { vars, sidebar };
}
