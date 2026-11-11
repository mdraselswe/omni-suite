# 9. Modules, settings and custom fields

## Decision

- Each feature is a module folder with a `manifest.ts`: key, label, permissions (with default roles), navigation entries, and whether tenants can switch it off. `src/modules.ts` lists all manifests.
- Tenants switch modules on or off in Settings (`tenants.settings.disabledModules`).
- Tenant settings live in one zod-validated JSON column: currency, timezone, locale, tax name/rate, fiscal year start, invoice prefix, pipeline stages, project statuses, expense categories (also a table), branding.
- Custom fields: `custom_field_defs` per tenant and entity; values in a `custom jsonb` column on clients, leads, projects and invoices.
- Core tables stay typed. No generic entity-attribute-value store.

## Why

New features plug in by adding a folder and one line in the registry. Tenants adapt the app without code, and the database stays simple and fast.
