# 10. Design system and per-business branding

## Decision

- One visual language for the app: light grey page, white cards with a soft brand-tinted shadow (`surface`), a sectioned sidebar with pill-shaped active items, round header controls, gradient stat cards, and a page search (Ctrl/⌘ + K).
- Every look-and-feel value is configuration, not component code:
  - Platform defaults in `src/config/site.ts` → `theme` (preset, background, radius, sidebar style, card depth, default mode) and `src/config/fonts.ts`.
  - Colour presets in `src/config/themes.ts`: brand colour (light/dark), accent, four gradients.
  - Each business can override preset, brand colour, sidebar style and logo in Settings → Branding (`tenants.settings.branding`).
- The values become CSS variables in a `<style>` tag (root layout for the platform, tenant layout for a business). Components use only the tokens (`bg-primary`, `surface`, `bg-gradient-1`, `bg-sidebar`…).
- Charts are small server-rendered SVGs (`src/components/data/area-chart.tsx`) with a screen-reader table, not a chart library.
- Motion uses transform and opacity only and is switched off by `prefers-reduced-motion` (Playwright runs with reduced motion so axe sees settled colours).

## Why

A business using OmniSuite on its own domain should see its own brand without code changes, and the platform look can change in one place. Server-rendered SVG keeps the client bundle small and works without JavaScript.

## Guard rails

- Only `#rrggbb` colours and `https://` logo links are accepted; `src/lib/theme.ts` checks every CSS variable name and value before writing it.
- `src/lib/theme.test.ts` checks contrast for every preset (white text on brand colour and gradients; dark-mode brand colour on the dark page). A custom brand colour gets white or black text, whichever reads better.
