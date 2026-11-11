import "server-only";
import { resolveTxt } from "node:dns/promises";
import { and, asc, desc, eq, ilike, isNotNull, lt, or, sql } from "drizzle-orm";
import { t } from "@/i18n";
import { fieldKey } from "@/lib/custom-fields";
import { randomToken } from "@/lib/ids";
import { tenantSettingsSchema, type TenantSettings } from "@/lib/tenant-settings";
import { MODULES } from "@/modules/catalog";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { auditLogs, customFieldDefs, memberships, tenantDomains, tenants, user } from "@/server/db/schema";
import type { TenantContext } from "@/server/tenancy/context";

/* ─── Settings ─────────────────────────────────────────────────── */

export async function updateSettings(
  database: Database,
  ctx: TenantContext,
  input: { name?: string; settings: Partial<TenantSettings> },
): Promise<void> {
  const merged = tenantSettingsSchema.parse({ ...ctx.tenant.settings, ...input.settings });
  await database.transaction(async (tx) => {
    await tx
      .update(tenants)
      .set({ settings: merged, ...(input.name ? { name: input.name } : {}), updatedAt: new Date() })
      .where(eq(tenants.id, ctx.tenant.id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "settings.update",
      entityType: "tenant",
      entityId: ctx.tenant.id,
      data: { name: input.name, keys: Object.keys(input.settings) },
    });
  });
}

export function optionalModules() {
  return MODULES.filter((m) => m.optional);
}

export async function setModuleEnabled(
  database: Database,
  ctx: TenantContext,
  key: string,
  enabled: boolean,
) {
  if (!optionalModules().some((m) => m.key === key)) throw new UserError(t("form.invalid"));
  const disabled = new Set(ctx.tenant.settings.disabledModules);
  if (enabled) disabled.delete(key);
  else disabled.add(key);
  await updateSettings(database, ctx, { settings: { disabledModules: [...disabled] } });
}

/* ─── Custom fields ────────────────────────────────────────────── */

export async function listCustomFields(database: DbOrTx, tenantId: string) {
  return database
    .select()
    .from(customFieldDefs)
    .where(eq(customFieldDefs.tenantId, tenantId))
    .orderBy(asc(customFieldDefs.entity), asc(customFieldDefs.position), asc(customFieldDefs.createdAt));
}

export async function addCustomField(
  database: Database,
  ctx: TenantContext,
  input: {
    entity: "client" | "lead" | "project" | "invoice";
    label: string;
    type: "text" | "number" | "date" | "select" | "checkbox";
    options: string[];
    required: boolean;
  },
) {
  if (input.type === "select" && input.options.length === 0) throw new UserError(t("settings.optionsNeeded"));
  const existing = await listCustomFields(database, ctx.tenant.id);
  let key = fieldKey(input.label);
  if (existing.some((f) => f.entity === input.entity && f.key === key))
    key = `${key}_${randomToken(3)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")}`;
  await database.transaction(async (tx) => {
    await tx.insert(customFieldDefs).values({
      tenantId: ctx.tenant.id,
      ...input,
      key,
      position: existing.filter((f) => f.entity === input.entity).length,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "customField.add",
      entityType: "customField",
      data: { ...input, key },
    });
  });
}

export async function deleteCustomField(database: Database, ctx: TenantContext, id: string) {
  await database.transaction(async (tx) => {
    const [row] = await tx
      .delete(customFieldDefs)
      .where(and(eq(customFieldDefs.id, id), eq(customFieldDefs.tenantId, ctx.tenant.id)))
      .returning();
    if (row) {
      await audit(tx, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        action: "customField.delete",
        entityType: "customField",
        data: { key: row.key },
      });
    }
  });
}

/* ─── Audit log ────────────────────────────────────────────────── */

export async function listAudit(
  database: DbOrTx,
  tenantId: string,
  filter: { q?: string; before?: Date; limit?: number } = {},
) {
  return database
    .select({ log: auditLogs, actorName: user.name, actorEmail: user.email })
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.actorUserId))
    .where(
      and(
        eq(auditLogs.tenantId, tenantId),
        filter.before ? lt(auditLogs.createdAt, filter.before) : undefined,
        filter.q
          ? or(
              ilike(auditLogs.action, `%${filter.q.replace(/[%_]/g, "")}%`),
              ilike(auditLogs.entityType, `%${filter.q.replace(/[%_]/g, "")}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(filter.limit ?? 100);
}

/* ─── Custom domains ───────────────────────────────────────────── */

export function normaliseHostname(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : null;
}

export async function listDomains(database: DbOrTx, tenantId: string) {
  return database
    .select()
    .from(tenantDomains)
    .where(eq(tenantDomains.tenantId, tenantId))
    .orderBy(asc(tenantDomains.createdAt));
}

export async function addDomain(
  database: Database,
  ctx: TenantContext,
  hostnameInput: string,
  appHost: string,
) {
  const hostname = normaliseHostname(hostnameInput);
  if (!hostname || hostname === appHost) throw new UserError(t("domains.invalid"));
  const [taken] = await database
    .select({ id: tenantDomains.id })
    .from(tenantDomains)
    .where(eq(tenantDomains.hostname, hostname));
  if (taken) throw new UserError(t("domains.taken"));
  await database.transaction(async (tx) => {
    await tx.insert(tenantDomains).values({
      tenantId: ctx.tenant.id,
      hostname,
      verificationToken: `omnisuite-verify=${randomToken(16)}`,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "domain.add",
      entityType: "domain",
      data: { hostname },
    });
  });
}

/** Checks the TXT record _omnisuite.<host>. */
export async function verifyDomain(
  database: Database,
  ctx: TenantContext,
  id: string,
  lookup: (name: string) => Promise<string[][]> = resolveTxt,
): Promise<boolean> {
  const [domain] = await database
    .select()
    .from(tenantDomains)
    .where(and(eq(tenantDomains.id, id), eq(tenantDomains.tenantId, ctx.tenant.id)));
  if (!domain) throw new UserError(t("domains.invalid"));
  let records: string[][] = [];
  try {
    records = await lookup(`_omnisuite.${domain.hostname}`);
  } catch {
    records = [];
  }
  const ok = records.some((parts) => parts.join("") === domain.verificationToken);
  if (!ok) return false;
  await database.transaction(async (tx) => {
    await tx.update(tenantDomains).set({ verifiedAt: new Date() }).where(eq(tenantDomains.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "domain.verify",
      entityType: "domain",
      data: { hostname: domain.hostname },
    });
  });
  return true;
}

export async function removeDomain(database: Database, ctx: TenantContext, id: string) {
  await database
    .delete(tenantDomains)
    .where(and(eq(tenantDomains.id, id), eq(tenantDomains.tenantId, ctx.tenant.id)));
}

/** Verified hostname → tenant slug (used by the proxy, Caddy's TLS check and the auth handoff). */
export async function tenantForHost(
  database: DbOrTx,
  hostname: string,
): Promise<{ slug: string; tenantId: string } | null> {
  const [row] = await database
    .select({ slug: tenants.slug, tenantId: tenants.id })
    .from(tenantDomains)
    .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
    .where(and(eq(tenantDomains.hostname, hostname.toLowerCase()), isNotNull(tenantDomains.verifiedAt)));
  return row ?? null;
}

/* ─── Platform admin ───────────────────────────────────────────── */

export async function platformTenants(database: DbOrTx) {
  const members = sql<number>`(select count(*)::int from ${memberships} where ${memberships.tenantId} = ${tenants.id})`;
  return database
    .select({ tenant: tenants, members })
    .from(tenants)
    .orderBy(desc(tenants.createdAt))
    .limit(1000);
}

export async function setTenantStatus(
  database: Database,
  actorUserId: string,
  input: { tenantId: string; status: "active" | "suspended"; plan: string },
) {
  await database.transaction(async (tx) => {
    await tx
      .update(tenants)
      .set({ status: input.status, plan: input.plan, updatedAt: new Date() })
      .where(eq(tenants.id, input.tenantId));
    await audit(tx, {
      tenantId: input.tenantId,
      actorUserId,
      action: "platform.tenantStatus",
      entityType: "tenant",
      entityId: input.tenantId,
      data: input,
    });
  });
}
