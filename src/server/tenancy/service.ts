import "server-only";
import { and, eq } from "drizzle-orm";
import { slugify } from "@/lib/ids";
import { parseTenantSettings, tenantSettingsSchema, type TenantSettings } from "@/lib/tenant-settings";
import { audit } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import {
  accounts,
  categories,
  memberRoles,
  memberships,
  onboardingTemplates,
  projectTemplates,
  tenants,
  user,
} from "@/server/db/schema";
import { loadPermissions, seedDefaultRoles } from "@/server/rbac/service";
import type { TenantContext } from "./context";

/** Paths that can never be tenant slugs. */
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "login",
  "logout",
  "signup",
  "invite",
  "onboarding",
  "select",
  "settings",
  "portal",
  "public",
  "static",
  "_next",
  "about",
  "help",
  "docs",
  "www",
  "p",
  "icons",
  "offline",
]);

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

export async function suggestSlug(database: DbOrTx, name: string): Promise<string> {
  const base = slugify(name) || "business";
  let candidate = isValidSlug(base) ? base : `${base}-co`;
  for (let i = 2; i < 100; i++) {
    const taken = await database.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, candidate));
    if (taken.length === 0) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const DEFAULT_EXPENSE_CATEGORIES = [
  "Salaries",
  "Rent",
  "Software & tools",
  "Advertising",
  "Contractors",
  "Office",
  "Bank fees",
  "Travel",
  "Other",
];
const DEFAULT_INCOME_CATEGORIES = ["Services", "Retainers", "Other income"];

/**
 * Creates a business with default roles, the creator as owner, starter
 * categories, a cash account and starter templates. Runs in one transaction.
 */
export async function createTenant(
  database: Database,
  input: { name: string; slug: string; ownerUserId: string; settings?: Partial<TenantSettings> },
): Promise<{ tenantId: string; membershipId: string }> {
  if (!isValidSlug(input.slug)) throw new Error("Invalid address");
  const settings = tenantSettingsSchema.parse(input.settings ?? {});
  return database.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({ name: input.name, slug: input.slug, settings })
      .returning({ id: tenants.id });
    if (!tenant) throw new Error("Tenant insert failed");
    const roleIds = await seedDefaultRoles(tx, tenant.id);
    const [membership] = await tx
      .insert(memberships)
      .values({ tenantId: tenant.id, userId: input.ownerUserId, kind: "internal", title: "Owner" })
      .returning({ id: memberships.id });
    if (!membership) throw new Error("Membership insert failed");
    await tx.insert(memberRoles).values({ membershipId: membership.id, roleId: roleIds.owner });

    await tx.insert(categories).values([
      ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
        tenantId: tenant.id,
        kind: "expense" as const,
        name,
      })),
      ...DEFAULT_INCOME_CATEGORIES.map((name) => ({ tenantId: tenant.id, kind: "income" as const, name })),
    ]);
    await tx
      .insert(accounts)
      .values({ tenantId: tenant.id, name: "Cash", type: "cash", currency: settings.currency });
    await tx.insert(onboardingTemplates).values({
      tenantId: tenant.id,
      name: "New client onboarding",
      fields: [
        { key: "business", label: "Business name", type: "text", required: true },
        { key: "goals", label: "What do you want to achieve?", type: "textarea", required: true },
        { key: "audience", label: "Who are your customers?", type: "textarea", required: false },
        { key: "brand", label: "Links to your logo or brand files", type: "textarea", required: false },
        { key: "website", label: "Current website (if any)", type: "text", required: false },
      ],
      checklist: [
        "Add us as a user on your domain registrar",
        "Add us to Google Analytics and Search Console",
        "Share brand files",
        "Book the kickoff call",
      ],
    });
    await tx.insert(projectTemplates).values({
      tenantId: tenant.id,
      name: "Website package",
      tasks: [
        { title: "Discovery", clientVisible: true },
        { title: "Sitemap", clientVisible: true },
        { title: "Design", clientVisible: true, needsApproval: true },
        { title: "Build", clientVisible: false },
        { title: "Client review", clientVisible: true, needsApproval: true },
        { title: "Launch", clientVisible: true },
        { title: "Handover", clientVisible: true },
      ],
    });
    await audit(tx, {
      tenantId: tenant.id,
      actorUserId: input.ownerUserId,
      action: "tenant.create",
      entityType: "tenant",
      entityId: tenant.id,
      data: { name: input.name, slug: input.slug },
    });
    return { tenantId: tenant.id, membershipId: membership.id };
  });
}

/** Tenants the user belongs to (for the switcher and the landing page). */
export async function userTenants(database: DbOrTx, userId: string) {
  return database
    .select({
      slug: tenants.slug,
      name: tenants.name,
      kind: memberships.kind,
      status: tenants.status,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
    .orderBy(tenants.name);
}

/** A tenants row as the request context's tenant (settings parsed). */
export function tenantFromRow(row: typeof tenants.$inferSelect): TenantContext["tenant"] {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    plan: row.plan,
    settings: parseTenantSettings(row.settings),
  };
}

/** The context tenant for jobs and webhooks (no signed-in user). Throws when it doesn't exist. */
export async function loadTenant(database: DbOrTx, tenantId: string): Promise<TenantContext["tenant"]> {
  const [row] = await database.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!row) throw new Error("Tenant not found");
  return tenantFromRow(row);
}

export type ContextResult =
  { ok: true; ctx: TenantContext } | { ok: false; reason: "no-tenant" | "no-membership" | "suspended" };

/** Builds the request context for a user inside a tenant. */
export async function buildTenantContext(
  database: DbOrTx,
  slug: string,
  userId: string,
  isPlatformAdmin: boolean,
): Promise<ContextResult> {
  const rows = await database
    .select({ tenant: tenants, membership: memberships, user })
    .from(tenants)
    .leftJoin(memberships, and(eq(memberships.tenantId, tenants.id), eq(memberships.userId, userId)))
    .innerJoin(user, eq(user.id, userId))
    .where(eq(tenants.slug, slug));
  const row = rows[0];
  if (!row) return { ok: false, reason: "no-tenant" };
  if (!row.membership || row.membership.status !== "active") return { ok: false, reason: "no-membership" };
  if (row.tenant.status === "suspended" && !isPlatformAdmin) return { ok: false, reason: "suspended" };
  const permissions = await loadPermissions(database, row.membership.id, row.tenant.permissionsVersion);
  return {
    ok: true,
    ctx: {
      tenant: tenantFromRow(row.tenant),
      user: { id: row.user.id, name: row.user.name, email: row.user.email, image: row.user.image },
      membership: {
        id: row.membership.id,
        kind: row.membership.kind,
        clientId: row.membership.clientId,
        title: row.membership.title,
      },
      permissions,
      isPlatformAdmin,
    },
  };
}
