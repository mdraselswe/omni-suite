# 4. Multi-tenancy: shared database, path-based tenants, custom domains by Host

## Decision

- One PostgreSQL database; every tenant-owned row has `tenant_id`. All access goes through context-scoped helpers (`src/server/tenancy`). A Vitest suite proves one tenant cannot read or change another's rows.
- Default address: `APP_URL/<tenant-slug>/…` (path based). The app URL comes from `APP_URL`, so the whole app can move to another domain by changing one variable.
- Custom domains: a tenant adds `app.theirbusiness.com` (CNAME to `CUSTOM_DOMAIN_TARGET`), proves ownership with a TXT record, and `proxy.ts` rewrites that host to `/<slug>/…`. Caddy's on-demand TLS asks `/api/domains/allowed?domain=…` before issuing a certificate.
- Sign-in always happens on `APP_URL`. A custom domain receives the session through a one-time handoff token (60 s, single use), valid only in the browser that started it (nonce cookie set by the domain's `/login`). The new session is bound to that one business by `session.bound_tenant_id` (lives and dies with the session); on a custom domain Better Auth only serves `get-session`, `sign-out` and `update-user`.

## Why

Path-based tenants on a single host avoid wildcard DNS, wildcard certificates and cross-subdomain cookies. Custom domains still give each business its own address when it wants one. A shared schema keeps queries and migrations simple and fast at our size.
