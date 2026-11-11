# OmniSuite

Business management for agencies and small businesses, built as a multi-tenant SaaS. Each business gets its own space at `app.omniscopedigital.com/<business>` (or its own domain), with:

- **Money:** accounts, append-only ledger with reversals, categories, closed periods, P&L, GST summary, CSV export
- **Partners & profit:** capital, ownership units, investments with dilution preview, transfers, profit rules (capital ratio, ownership, fixed percent, weighted) with reserve and fixed fees, approved by every partner, distributions and partner statements
- **Clients:** leads pipeline, clients with custom fields and CSV import, onboarding forms and checklists, proposals with e-acceptance, invoices (GST, payments, recurring, print), client portal
- **Work:** projects from templates, tasks with client approval, comments, files, time tracking, hourly rates and project economics
- **Team:** invitations, fully editable roles, per-person allow/deny overrides with scope and expiry, activity log
- **Platform:** modules on/off, custom fields, pipeline stages, custom domains with automatic HTTPS, one-way backup to Google Sheets + nightly JSON in Drive, platform admin

Stack: Next.js 16 (App Router, server mode) · React 19 · TypeScript strict · Tailwind 4 + shadcn/ui · Postgres + Drizzle · Better Auth (Google, email/password) · Vitest + PGlite · Playwright + axe.

## Run it locally

```bash
pnpm install
docker compose up -d
cp .env.example .env.local   # then fill BETTER_AUTH_SECRET and ENCRYPTION_KEY
pnpm db:seed
pnpm dev
```

Open http://localhost:3000 and use a demo account (password `omnisuite-demo-2026`). Step-by-step test guide in Bangla: [docs/local-test-bn.md](docs/local-test-bn.md).

## Commands

| Command                     | What it does                                                         |
| --------------------------- | -------------------------------------------------------------------- |
| `pnpm dev`                  | Dev server (migrations apply and the job worker starts on boot)      |
| `pnpm db:seed`              | Apply migrations and load the demo business (sample data only)       |
| `pnpm db:migrate`           | Apply migrations                                                     |
| `pnpm db:generate`          | Create a migration after changing `src/server/db/schema`             |
| `pnpm check`                | Typecheck, lint, format check, unit tests, build. Run before commits |
| `pnpm test:e2e`             | Playwright + axe against the production build and a seeded database  |
| `pnpm build` / `pnpm start` | Production build / serve it                                          |

## Docs

- [Architecture](docs/architecture.md) and decisions in [docs/adr](docs/adr)
- [Configuration](docs/configuration.md): where every value lives
- [Deployment](docs/deployment.md): one VPS with Docker, Caddy and Postgres
- [AGENTS.md](AGENTS.md): rules for anyone (human or AI) changing the code

Built from the next-starter template.
