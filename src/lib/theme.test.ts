import { describe, expect, it } from "vitest";
import { THEME_PRESETS, themePresets } from "@/config";
import { contrastRatio, readableText, tenantTheme, themeCss, themeVariables } from "./theme";

describe("contrast", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("picks readable text", () => {
    expect(readableText("#1d64d8")).toBe("#ffffff");
    expect(readableText("#fde68a")).toBe("#14141f");
  });
});

describe("presets", () => {
  for (const key of THEME_PRESETS) {
    const preset = themePresets[key];
    it(`${key}: white text is readable on the brand colour and every gradient stop`, () => {
      for (const colour of [preset.primary.light, ...preset.gradients.flat()]) {
        expect(contrastRatio(colour, "#ffffff"), colour).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${key}: dark-mode brand colour works on the dark page and with its text`, () => {
      expect(contrastRatio(preset.primary.dark, "#0f1117")).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(preset.primary.dark, preset.primaryForeground.dark)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("theme variables", () => {
  it("uses a custom brand colour with readable text", () => {
    const vars = themeVariables({ preset: "violet", brandColor: "#fde68a" });
    expect(vars["--brand"]).toBe("#fde68a");
    expect(vars["--brand-foreground"]).toBe("#14141f");
    expect(vars["--gradient-1-from"]).toBe(themePresets.violet.gradients[0][0]);
  });

  it("ignores anything that is not a hex colour", () => {
    const vars = themeVariables({ preset: "ocean", brandColor: "red;}body{display:none" });
    expect(vars["--brand"]).toBe(themePresets.ocean.primary.light);
  });

  it("drops unsafe names and values from CSS", () => {
    const css = themeCss(":root", { "--ok": "#123456", "--bad": "x;}body{color:red", bad: "#fff" });
    expect(css).toBe(":root{--ok:#123456}");
  });

  it("falls back to the platform look when a business picks nothing", () => {
    expect(tenantTheme({ preset: "", brandColor: "", sidebar: "" })).toEqual({
      vars: null,
      sidebar: "light",
    });
    const picked = tenantTheme({ preset: "emerald", brandColor: "nope", sidebar: "dark" });
    expect(picked.sidebar).toBe("dark");
    expect(picked.vars?.["--brand"]).toBe(themePresets.emerald.primary.light);
  });
});
