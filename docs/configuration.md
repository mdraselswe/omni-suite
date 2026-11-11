# Configuration map

Everything project-specific lives in a few files. A new project changes these, not components.

| What                                                                | File                                               | Checked by                   |
| ------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------- |
| Name, description, URL, locale, direction                           | `src/config/site.ts`                               | zod (`siteSchema`)           |
| Render mode (`static` / `server`)                                   | `src/config/site.ts` → `render`                    | zod; switch with `pnpm mode` |
| Theme: colour preset, background, radius, sidebar, card depth, mode | `src/config/site.ts` → `theme`                     | zod; e2e axe contrast check  |
| Colour presets (brand colour, gradients, chart colours)             | `src/config/themes.ts`                             | contrast unit test           |
| Contact, social links, SEO title/keywords                           | `src/config/site.ts`                               | zod                          |
| Feature switches (PWA, install card, offline banner, theme toggle)  | `src/config/features.ts`                           | zod                          |
| Fonts                                                               | `src/config/fonts.ts`                              | TypeScript                   |
| Routes (internal links) and sitemap pages                           | `src/config/routes.ts`                             | `typedRoutes`                |
| Header/footer links                                                 | `src/config/navigation.ts`                         | TypeScript (i18n keys)       |
| UI text, labels, errors                                             | `src/i18n/messages/en.ts`                          | typed keys                   |
| Page content (hero, lists, data)                                    | `src/content/*.ts`                                 | TypeScript                   |
| Environment variables                                               | `src/config/env.ts` + `.env.example`               | zod                          |
| Design tokens beyond the brand (spacing, shadows, extra colours)    | `src/app/globals.css` (`:root`, `.dark`, `@theme`) | prettier/Tailwind            |
| Held-back package majors                                            | `version-holds.json` (+ `.github/dependabot.yml`)  | `pnpm freshness`             |

Generated from config on every `dev`/`build` (git-ignored, don't edit): `public/robots.txt`, `public/sitemap.xml`, `public/manifest.webmanifest`, `public/icons/*`, `public/sw.js`.

## How colours flow

1. **Platform default:** `site.theme.preset` picks a palette from `src/config/themes.ts`. `site.theme` also sets the page background, corner radius, sidebar style (`light` / `dark` / `brand`) and card depth (`tinted` / `soft` / `flat`).
2. **Per business:** Settings → Branding lets a business choose another preset, its own brand colour (#rrggbb; text on it turns white or black automatically), the sidebar style and a logo link. Stored in `tenants.settings.branding`, validated by `src/lib/tenant-settings.ts`.
3. `src/lib/theme.ts` turns the choice into CSS variables (`--brand*`, `--gradient-N-from/to`, `--radius`, `--surface-*`). The root layout writes the platform ones into a `<style>` tag; the tenant layout adds a business's overrides. Every name and value is checked before it reaches CSS.
4. `globals.css` maps them onto the design tokens (`--primary`, `--chart-*`, `--sidebar-*`) → Tailwind/shadcn classes (`bg-primary`, `surface`, `bg-gradient-1`, `shadow-surface`).

`src/lib/theme.test.ts` fails if a preset's brand colour or any gradient stop is too light for white text, or its dark-mode colour doesn't read on the dark page. The app icon and browser theme colour use the platform preset.

Motion lives in `globals.css` too (`animate-rise`, `stagger`, `hover-lift`, `animate-grow-x`, `animate-float`). It uses transform and opacity only and switches off with reduced motion.

## Render modes

|                                                                               | `static`                                                | `server`                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------- |
| Output                                                                        | Plain files in `out/`                                   | Next.js server (`.next/`) |
| Host                                                                          | Anywhere static (Vercel, Netlify, Cloudflare Pages, S3) | Vercel or any Node host   |
| Cache Components, `"use cache"`, Partial Prefetching                          | off (not supported in export)                           | on                        |
| Server Actions, route handlers using the request, cookies, headers, redirects | not available (build fails)                             | available                 |
| Offline                                                                       | whole site precached                                    | pages cached as visited   |

Switch with `pnpm mode static` or `pnpm mode server`. CI builds both modes, so code stays portable until you commit to one.

## Adding a config value

1. Add the field to the schema in `src/config/schema.ts` (with a comment).
2. Set it in `site.ts` or `features.ts`.
3. Read it through `import { site, features } from "@/config"`.
4. Document it in this table.
