# OmniSuite architecture

OmniSuite is a multi-tenant business operating system: partners, money, profit sharing, clients, onboarding, proposals, invoices, projects, time, files and a client portal. OmniScope Digital is tenant #1. Any business can sign up and use it on the shared app URL or on its own domain.

## Shape

```
Browser ──▶ Caddy (TLS, on-demand certs for verified tenant domains)
              │
              ▼
           Next.js 16 (server mode, one codebase)
              │  proxy.ts: Host → tenant (custom domains only)
              │  /[tenant]/…        team area (members with internal roles)
              │  /[tenant]/portal/… client portal (client roles)
              │  /admin/…           platform admin (PLATFORM_ADMIN_EMAILS)
              ▼
           PostgreSQL 18  ◀──  job worker (inside the web process, started by
                                src/instrumentation.ts): jobs table
                                ├─▶ Google Sheets + JSON in Drive (one-way mirror)
                                ├─▶ recurring invoices
                                └─▶ email (SMTP: Mailpit locally)
```

One server runs everything (`docker-compose.prod.yml`, see `docs/deployment.md`). Set `WORKER_ENABLED=false` on extra web instances if you ever run more than one. There is no Redis or external queue: the `jobs` table is the queue (`FOR UPDATE SKIP LOCKED`).

## Code layout

| Path                     | What                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`               | Routes only: thin pages that call feature services and render components. `api/` holds auth, exports, files, Google, domains          |
| `src/proxy.ts`           | Custom domain → tenant rewrite and sign-in handoff                                                                                    |
| `src/server/`            | Server core: `db/` (schema, client, migrations), `auth/`, `tenancy/`, `rbac/`, `jobs/`, `audit`, `crypto`, `google`, `export`, `seed` |
| `src/features/<module>/` | `service.ts` (queries and rules, tested with PGlite), `actions.ts` (Server Actions), small client components, public `index.ts`       |
| `src/modules/catalog.ts` | Module registry: every permission and nav entry, so roles, menus and module switches come from one list                               |
| `src/components/`        | shadcn primitives, layout (shell, nav, notifications), form and data helpers                                                          |
| `src/lib/`               | Pure helpers (money, dates, line items, custom fields) with tests                                                                     |
| `src/i18n/messages/`     | All UI text, split by area                                                                                                            |
| `drizzle/`               | Generated SQL migrations                                                                                                              |

## Request flow (team page)

1. `proxy.ts` rewrites a verified custom domain's `/` to `/<tenantSlug>/`; the app host passes straight through.
2. `requireTenant(slug)` (cached per request): session → tenant → membership → effective permissions (cached in memory per membership and `permissions_version`).
3. Pages call `requireTenantPermission(slug, permission)` (404 when not allowed) and feature services with that context. Services filter by `tenant_id` and by the member's scope (own / assigned / all).
4. Forms post to Server Actions: `actionContext` re-checks the permission, zod validates, the service writes inside a transaction with an audit entry and a sync-outbox row, then the page refreshes.

## Principles

- Database is the source of truth. Google Sheets/JSON are mirrors, never read back.
- Money is `bigint` minor units with a currency. No floats.
- Ledgers are append-only. Corrections are reversal entries. Closed periods are locked.
- Effective-dated records (ownership, profit rules, role overrides with expiry).
- `tenant_id` on every tenant table; every index starts with it.
- Deny by default. Client users can never hold internal permissions.
- Configuration over code: tenant settings (zod-validated JSON), custom fields, configurable lists, module switches.

Decisions and their reasons are in `docs/adr/`.
