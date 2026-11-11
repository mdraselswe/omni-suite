import type { ThemePresetKey } from "./schema.ts";

/**
 * ✏️ Colour presets. The platform default is `site.theme.preset`; each business can
 * pick another one (or its own brand colour) in Settings → Branding.
 *
 * Rules (checked by src/lib/theme.test.ts):
 * - `primary.light` and every gradient stop carry white text, so they need 4.5:1 contrast with white.
 * - `primary.dark` sits on the dark page, `primaryForeground.dark` sits on it.
 * Names shown in the UI live in i18n (`theme.preset.<key>`).
 */
export type Gradient = readonly [from: string, to: string];

export type ThemePreset = {
  primary: { light: string; dark: string };
  primaryForeground: { light: string; dark: string };
  /** Second colour: the second chart series and highlights next to the brand colour. */
  accent: { light: string; dark: string };
  /** Stat card backgrounds, in order. */
  gradients: readonly [Gradient, Gradient, Gradient, Gradient];
};

export const themePresets: Record<ThemePresetKey, ThemePreset> = {
  violet: {
    primary: { light: "#7352c7", dark: "#a78bfa" },
    primaryForeground: { light: "#ffffff", dark: "#1a1033" },
    accent: { light: "#0e9f7e", dark: "#34d3a6" },
    gradients: [
      ["#2563c9", "#7352c7"],
      ["#c2366b", "#7e2a9c"],
      ["#0b7a63", "#0e6e8c"],
      ["#b4540a", "#a3302a"],
    ],
  },
  ocean: {
    primary: { light: "#1d64d8", dark: "#7ab0ff" },
    primaryForeground: { light: "#ffffff", dark: "#08162e" },
    accent: { light: "#0e8f86", dark: "#3fd7c7" },
    gradients: [
      ["#1d64d8", "#4f46e5"],
      ["#0f766e", "#1d64d8"],
      ["#7c3aed", "#1d4ed8"],
      ["#be4a12", "#b91c5c"],
    ],
  },
  emerald: {
    primary: { light: "#0b7a5e", dark: "#4adeaa" },
    primaryForeground: { light: "#ffffff", dark: "#04241a" },
    accent: { light: "#1f6fd1", dark: "#7ab0ff" },
    gradients: [
      ["#0b7a5e", "#0e6e8c"],
      ["#1f6fd1", "#0b7a5e"],
      ["#6d46c9", "#0e6e8c"],
      ["#b4540a", "#a3302a"],
    ],
  },
  sunset: {
    primary: { light: "#c2410c", dark: "#fb923c" },
    primaryForeground: { light: "#ffffff", dark: "#2a0e02" },
    accent: { light: "#7352c7", dark: "#a78bfa" },
    gradients: [
      ["#c2410c", "#be185d"],
      ["#b45309", "#c2410c"],
      ["#7352c7", "#be185d"],
      ["#0b7a63", "#0e6e8c"],
    ],
  },
  rose: {
    primary: { light: "#be185d", dark: "#f472b6" },
    primaryForeground: { light: "#ffffff", dark: "#2b0618" },
    accent: { light: "#0e7490", dark: "#22d3ee" },
    gradients: [
      ["#be185d", "#7e22ce"],
      ["#c2410c", "#be185d"],
      ["#2563c9", "#7e22ce"],
      ["#0b7a63", "#0e6e8c"],
    ],
  },
  graphite: {
    primary: { light: "#374151", dark: "#cbd5e1" },
    primaryForeground: { light: "#ffffff", dark: "#0f172a" },
    accent: { light: "#2563c9", dark: "#7ab0ff" },
    gradients: [
      ["#374151", "#111827"],
      ["#2563c9", "#374151"],
      ["#0b7a63", "#374151"],
      ["#b4540a", "#7f1d1d"],
    ],
  },
};
