# OmniSuite architecture

OmniSuite is a multi-tenant business operating system: partners, money, profit sharing, clients, onboarding, proposals, invoices, projects, time, files and a client portal. OmniScope Digital is tenant #1. Any business can sign up and use it on the shared app URL or on its own domain.

## Shape

```
Browser ──▶ Caddy (TLS, on-demand certs for verified tenant domains)
              │
              ▼
           Next.js 16 (server mode, one codebase)
              │  proxy.ts: Host header → tenant (custom domains only)
              │  /[tenant]/…        team area (members with internal roles)
              │  /[tenant]/portal/… client portal (client roles)
              │  /admin/…           platform admin (PLATFORM_ADMIN_EMAILS)
              ▼
           PostgreSQL 18  ◀──  job worker (inside the web process, started by
                                src/instrumentation.ts): jobs table
                                ├─▶ Google Sheets + JSON in Drive (one-way mirror)
                                ├─▶ Xero (one-way push)
                                ├─▶ recurring invoices
                                └─▶ email (mail.send jobs → SMTP; Mailpit locally)
```

One server runs everything (`docker-compose.prod.yml`, see `docs/deployment.md`). Set `WORKER_ENABLED=false` on extra web instances if you ever run more than one. There is no Redis or external queue: the `jobs` table is the queue (`FOR UPDATE SKIP LOCKED`).

On start (`src/server/boot.ts`) the server refuses to run with the public default `BETTER_AUTH_SECRET` / `ENCRYPTION_KEY` (production on a non-local `APP_URL`) and exits when a migration fails, so it never serves an old schema.

## Jobs

- `enqueue` adds a job; a `dedupe_key` allows one pending job per key (`jobs_dedupe_uq`). Failed attempts retry after 1, 4, 9 and 16 minutes, then the job is `failed` with `last_error` (its `run_at` is when it gave up).
- A running job refreshes `locked_at` every minute. The scheduler tick (every minute; recover, schedule and prune each fail on their own) puts jobs whose lock is over 10 minutes old back in the queue, unless they used all 5 attempts or a pending duplicate exists (then they are marked failed).
- Time-based jobs (`scheduleRecurring`) use `enqueueUnlessBusy`: nothing is queued while the same job is pending or running, or during a cool-down after it failed (snapshot 6 h, Xero and recurring invoices 1 h). Recurring invoices are due by each tenant's own time zone.
- Email: `queueMail(tx, …)` / `notify(…, { email: true })` add a `mail.send` job in the caller's transaction, so mail goes out only after commit and survives restarts. App-relative links become absolute (`APP_URL`). Each attempt reuses one Message-ID.

## Backup (ADR 0007)

`markChanged` (in the write transaction) adds a `sync_outbox` row and one `backup.sync` job due a minute later, so a burst of writes is mirrored once. Tenants without a Google connection get neither. Incremental syncs rewrite only the affected tabs; the audit log tab is refreshed by full syncs and the nightly snapshot, which also uploads the JSON export. Failures are stored in `google_connections.last_error`.

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

1. `proxy.ts` reads the `Host` header (`X-Forwarded-Host` only with `TRUST_FORWARDED_HOST`; Caddy keeps `Host`) and rewrites a verified custom domain's `/` to `/<tenantSlug>/`; the app host passes straight through. Lookups are cached in a bounded LRU (1,000 hosts; verified for 1 minute, unknown for 5) and malformed hosts never reach the database.
2. `requireTenant(slug)` (cached per request): session → tenant → membership → effective permissions (cached in memory per membership and `permissions_version`).
3. Pages call `requireTenantPermission(slug, permission)` (404 when not allowed) and feature services with that context. Services filter by `tenant_id` and by the member's scope (own / assigned / all).
4. Forms post to Server Actions: `actionContext` re-checks the permission, zod validates, the service writes inside a transaction with an audit entry and (when Google backup is connected) a sync-outbox row, then the page refreshes.
5. Exports (`/api/t/<tenant>/export/<set>.csv`) check the set's own permission with "all" scope (`EXPORT_PERMISSIONS` in `src/server/export.ts`: leads → `leads.read`, audit log → `audit.read`, ledgers → `finance.export`, …); the full JSON needs `backup.manage`.

## Principles

- Database is the source of truth. Google Sheets/JSON are mirrors, never read back.
- Money is `bigint` minor units with a currency. No floats.
- Ledgers are append-only. Corrections are reversal entries. Closed periods are locked.
- Effective-dated records (ownership, profit rules, role overrides with expiry).
- `tenant_id` on every top-level tenant table, and its tenant-scoped indexes start with it (platform tables such as `jobs` and `user` are not tenant tables). Child tables (`role_permissions`, `member_roles`, `member_rates`, `project_members`, `profit_rule_approvals`, …) are scoped through their parent row instead: always reach them through a tenant-checked parent.
- Deny by default. Client users can never hold internal permissions.
- Configuration over code: tenant settings (zod-validated JSON), custom fields, configurable lists, module switches.

Decisions and their reasons are in `docs/adr/`.
