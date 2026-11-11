import "server-only";
import { createHmac } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { site } from "@/config";
import { serverEnv } from "@/config/env";
import { t } from "@/i18n";
import { fieldKey } from "@/lib/custom-fields";
import { randomToken } from "@/lib/ids";
import { tenantSettingsSchema, type TenantSettings } from "@/lib/tenant-settings";
import { MODULES } from "@/modules/catalog";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import {
  auditLogs,
  customFieldDefs,
  leads,
  memberships,
  projects,
  tenantDomains,
  tenants,
  user,
} from "@/server/db/schema";
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

/**
 * How many records still use stage / status keys that are about to be removed.
 * Archived leads don't count (they aren't on the board).
 */
export async function keysInUse(
  database: DbOrTx,
  tenantId: string,
  removed: { stages: string[]; statuses: string[] },
): Promise<{ stages: Map<string, number>; statuses: Map<string, number> }> {
  const stages = new Map<string, number>();
  const statuses = new Map<string, number>();
  if (removed.stages.length > 0) {
    const rows = await database
      .select({ key: leads.stage, n: count() })
      .from(leads)
      .where(
        and(eq(leads.tenantId, tenantId), inArray(leads.stage, removed.stages), isNull(leads.archivedAt)),
      )
      .groupBy(leads.stage);
    for (const r of rows) stages.set(r.key, r.n);
  }
  if (removed.statuses.length > 0) {
    const rows = await database
      .select({ key: projects.status, n: count() })
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), inArray(projects.status, removed.statuses)))
      .groupBy(projects.status);
    for (const r of rows) statuses.set(r.key, r.n);
  }
  return { stages, statuses };
}

/**
 * Saves lead stages and project statuses. A key that records still use can't be
 * removed (those records would drop off the board); the error says how many.
 */
export async function updatePipeline(
  database: Database,
  ctx: TenantContext,
  input: Pick<TenantSettings, "pipelineStages" | "projectStatuses">,
) {
  const newStages = new Set(input.pipelineStages.map((s) => s.key));
  const newStatuses = new Set(input.projectStatuses.map((s) => s.key));
  const removed = {
    stages: ctx.tenant.settings.pipelineStages.map((s) => s.key).filter((k) => !newStages.has(k)),
    statuses: ctx.tenant.settings.projectStatuses.map((s) => s.key).filter((k) => !newStatuses.has(k)),
  };
  const used = await keysInUse(database, ctx.tenant.id, removed);
  const stage = [...used.stages][0];
  if (stage) throw new UserError(t("settings.stageInUse", { key: stage[0], count: stage[1] }));
  const status = [...used.statuses][0];
  if (status) throw new UserError(t("settings.statusInUse", { key: status[0], count: status[1] }));
  await updateSettings(database, ctx, { settings: input });
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

/** Changes a field's label, choices and "required". Its key and type stay, so saved values keep working. */
export async function updateCustomField(
  database: Database,
  ctx: TenantContext,
  id: string,
  input: { label: string; options: string[]; required: boolean },
) {
  await database.transaction(async (tx) => {
    const [field] = await tx
      .select()
      .from(customFieldDefs)
      .where(and(eq(customFieldDefs.id, id), eq(customFieldDefs.tenantId, ctx.tenant.id)));
    if (!field) throw new UserError(t("settings.fieldMissing"));
    const options = field.type === "select" ? [...new Set(input.options)] : [];
    if (field.type === "select" && options.length === 0) throw new UserError(t("settings.optionsNeeded"));
    await tx
      .update(customFieldDefs)
      .set({ label: input.label, options, required: input.required })
      .where(eq(customFieldDefs.id, id));
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "customField.update",
      entityType: "customField",
      data: { key: field.key, label: input.label, options, required: input.required },
    });
  });
}

/** Moves a field one place up or down among the fields of the same record type. */
export async function moveCustomField(
  database: Database,
  ctx: TenantContext,
  id: string,
  direction: "up" | "down",
) {
  await database.transaction(async (tx) => {
    const [field] = await tx
      .select()
      .from(customFieldDefs)
      .where(and(eq(customFieldDefs.id, id), eq(customFieldDefs.tenantId, ctx.tenant.id)));
    if (!field) throw new UserError(t("settings.fieldMissing"));
    const siblings = (await listCustomFields(tx, ctx.tenant.id)).filter((f) => f.entity === field.entity);
    const from = siblings.findIndex((f) => f.id === id);
    const to = direction === "up" ? from - 1 : from + 1;
    const other = siblings[to];
    if (from < 0 || !other) return;
    siblings[to] = field;
    siblings[from] = other;
    // Rewrite positions 0..n so old duplicates or gaps can't make the order unstable.
    for (const [position, f] of siblings.entries()) {
      if (f.position !== position)
        await tx.update(customFieldDefs).set({ position }).where(eq(customFieldDefs.id, f.id));
    }
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

type TxtLookup = (name: string) => Promise<string[][]>;

/** DNS name of the ownership TXT record for a hostname, e.g. `_omnisuite.portal.example.com`. */
export function domainVerifyName(hostname: string): string {
  return `${site.domainVerifyLabel}.${hostname}`;
}

/**
 * The TXT value a business must publish for a hostname. Derived from a secret,
 * the business and the hostname: it is the same every time that business adds
 * that hostname (a record they already published keeps working), and nobody
 * else can produce it.
 */
export function domainToken(secret: string, tenantId: string, hostname: string): string {
  const mac = createHmac("sha256", secret).update(`${tenantId}:${hostname}`).digest("base64url").slice(0, 24);
  return `${site.domainVerifyLabel.slice(1)}-verify=${mac}`;
}

async function txtMatches(lookup: TxtLookup, hostname: string, token: string): Promise<boolean> {
  try {
    const records = await lookup(domainVerifyName(hostname));
    return records.some((parts) => parts.join("") === token);
  } catch {
    return false;
  }
}

/**
 * Adds a domain claim. Only a domain VERIFIED by another business is off limits.
 * Another business's unverified claim doesn't block anyone: whoever proves
 * ownership in DNS first gets the domain (the stale claim is replaced), so a
 * domain can't be squatted.
 */
export async function addDomain(
  database: Database,
  ctx: TenantContext,
  hostnameInput: string,
  appHost: string,
  options: { secret?: string; lookup?: TxtLookup } = {},
) {
  const hostname = normaliseHostname(hostnameInput);
  if (!hostname || hostname === appHost) throw new UserError(t("domains.invalid"));
  const token = domainToken(options.secret ?? serverEnv().BETTER_AUTH_SECRET, ctx.tenant.id, hostname);
  const [existing] = await database.select().from(tenantDomains).where(eq(tenantDomains.hostname, hostname));
  let replaces: string | null = null;
  if (existing) {
    if (existing.tenantId === ctx.tenant.id) throw new UserError(t("domains.alreadyAdded"));
    if (existing.verifiedAt) throw new UserError(t("domains.taken"));
    // Someone else's unverified claim: it can be taken over only by proving ownership now.
    if (!(await txtMatches(options.lookup ?? resolveTxt, hostname, token))) {
      throw new UserError(t("domains.claimPending", { name: domainVerifyName(hostname), value: token }));
    }
    replaces = existing.id;
  }
  await database.transaction(async (tx) => {
    if (replaces) {
      // Re-checked inside the transaction: never replace a claim that got verified meanwhile.
      const [gone] = await tx
        .delete(tenantDomains)
        .where(and(eq(tenantDomains.id, replaces), isNull(tenantDomains.verifiedAt)))
        .returning({ tenantId: tenantDomains.tenantId });
      if (!gone) throw new UserError(t("domains.taken"));
      await audit(tx, {
        tenantId: gone.tenantId,
        actorUserId: ctx.user.id,
        action: "domain.claimReplaced",
        entityType: "domain",
        data: { hostname },
      });
    }
    await tx.insert(tenantDomains).values({
      tenantId: ctx.tenant.id,
      hostname,
      verificationToken: token,
      verifiedAt: replaces ? new Date() : null,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: replaces ? "domain.verify" : "domain.add",
      entityType: "domain",
      data: { hostname },
    });
  });
}

/** Checks the TXT record <label>.<host>. Refused if another business already verified the hostname. */
export async function verifyDomain(
  database: Database,
  ctx: TenantContext,
  id: string,
  lookup: TxtLookup = resolveTxt,
): Promise<boolean> {
  const [domain] = await database
    .select()
    .from(tenantDomains)
    .where(and(eq(tenantDomains.id, id), eq(tenantDomains.tenantId, ctx.tenant.id)));
  if (!domain) throw new UserError(t("domains.invalid"));
  const [elsewhere] = await database
    .select({ id: tenantDomains.id })
    .from(tenantDomains)
    .where(
      and(
        eq(tenantDomains.hostname, domain.hostname),
        ne(tenantDomains.tenantId, ctx.tenant.id),
        isNotNull(tenantDomains.verifiedAt),
      ),
    );
  if (elsewhere) throw new UserError(t("domains.taken"));
  if (!(await txtMatches(lookup, domain.hostname, domain.verificationToken))) return false;
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
  // A join, not a correlated subquery: inside sql`` Drizzle prints bare column names,
  // so `tenant_id = id` would compare against memberships.id and always count 0.
  return database
    .select({ tenant: tenants, members: count(memberships.tenantId) })
    .from(tenants)
    .leftJoin(memberships, eq(memberships.tenantId, tenants.id))
    .groupBy(tenants.id)
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
