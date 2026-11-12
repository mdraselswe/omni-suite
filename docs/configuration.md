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
| AI providers, models, per-feature overrides, daily AI limit         | `src/config/ai.ts` (keys in `src/config/env.ts`)   | zod (`aiSchema`)             |
| List page sizes, default page size, search delay, board column size | `src/config/lists.ts`                              | zod (`listsSchema`)          |
| Mail quotas, storage quota per business, sign-in throttle per email | `src/config/limits.ts`                             | zod (`limitsSchema`)         |
| Fonts                                                               | `src/config/fonts.ts`                              | TypeScript                   |
| Routes (internal links) and sitemap pages                           | `src/config/routes.ts`                             | `typedRoutes`                |
| Header/footer links                                                 | `src/config/navigation.ts`                         | TypeScript (i18n keys)       |
| Number formats, time zone → currency guesses, exchange-rate source  | `src/config/regional.ts` (+ env `FX_PROVIDER`)     | zod (`regionalSchema`)       |
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

## AI providers

Claude (`anthropic`) is the default and the only provider with a key today. Every AI call goes through `src/server/ai/`: a feature (`proposalDraft`, `insights`) asks the registry, which picks the provider and model from `src/config/ai.ts` and returns text plus token counts. The daily allowance, token recording and error messages in `src/features/ai/run.ts` are the same for every provider.

- **Switch everything:** set `defaultProvider` in `src/config/ai.ts` and that provider's key in env.
- **Switch one feature:** add an override, e.g. `features: { insights: { model: "claude-haiku-5-5" } }` (cheaper Claude model) or `features: { proposalDraft: { provider: "openai-compatible", model: "gpt-5-mini" } }`. Leave out `provider` to keep the default one; leave out `model` to use the provider's own.
- **OpenAI-style services** (OpenAI, OpenRouter, Groq, DeepSeek, Ollama, Gemini's OpenAI endpoint): set `providers["openai-compatible"].baseUrl` and `model`, put the key in `OPENAI_COMPATIBLE_API_KEY` (any value for a local Ollama). If the service doesn't support strict JSON schemas, set `jsonMode` to `"json_object"` or `"none"`; if it rejects `max_completion_tokens`, set `tokenLimitParam` to `"max_tokens"`.
- A feature is hidden (and its action refuses) until the provider it uses has a key.

**Adding a new kind of provider** (one that isn't OpenAI-compatible):

1. Write `src/server/ai/<name>.ts` that returns an `AiProvider` (`complete(request)` → `{ text, inputTokens, outputTokens, model }`; throw `AiNoAnswerError` for a refusal or cut-off, `AiProviderError` for HTTP failures, never with the prompt in the message). Add a unit test with a mocked client or `fetch`.
2. Add its id to `AI_PROVIDERS` and its settings under `providers` in `aiSchema` (`src/config/schema.ts`), then fill them in `src/config/ai.ts`.
3. Add its key to `serverSchema` in `src/config/env.ts` (empty default) and `.env.example`, and register the factory and key name in `src/server/ai/registry.ts`.
