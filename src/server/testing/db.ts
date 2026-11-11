import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { setDb, type Database } from "@/server/db";
import * as schema from "@/server/db/schema";
import { user } from "@/server/db/schema";
import { uuidv7 } from "@/lib/ids";
import { clearPermissionCache } from "@/server/rbac/service";

/**
 * In-memory Postgres (PGlite) with all migrations applied. Each test file gets
 * its own database, installed as the app database with `setDb`.
 */
export async function createTestDb(): Promise<Database> {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  setDb(database as unknown as Database);
  clearPermissionCache();
  return database as unknown as Database;
}

export async function createUser(database: Database, name: string, email?: string): Promise<string> {
  const id = uuidv7();
  await database.insert(user).values({
    id,
    name,
    email: email ?? `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    emailVerified: true,
  });
  return id;
}

/** A tenant with an owner, returning the owner's request context. */
export async function setupTenant(database: Database, slug: string) {
  const { createTenant, buildTenantContext } = await import("@/server/tenancy/service");
  const ownerId = await createUser(database, `Owner ${slug}`, `owner@${slug}.test`);
  const { tenantId } = await createTenant(database, { name: `Biz ${slug}`, slug, ownerUserId: ownerId });
  const result = await buildTenantContext(database, slug, ownerId, false);
  if (!result.ok) throw new Error("context failed");
  return { tenantId, ownerId, ctx: result.ctx };
}

/** Adds a member with a default role and returns their context. */
export async function addMember(
  database: Database,
  slug: string,
  roleKey: string,
  name: string,
  options: { kind?: "internal" | "client"; clientId?: string } = {},
) {
  const { and, eq } = await import("drizzle-orm");
  const { memberRoles, memberships, roles, tenants } = await import("@/server/db/schema");
  const { buildTenantContext } = await import("@/server/tenancy/service");
  const { bumpPermissionsVersion } = await import("@/server/rbac/service");
  const [tenant] = await database.select().from(tenants).where(eq(tenants.slug, slug));
  if (!tenant) throw new Error("no tenant");
  const userId = await createUser(database, name);
  const [m] = await database
    .insert(memberships)
    .values({
      tenantId: tenant.id,
      userId,
      kind: options.kind ?? "internal",
      clientId: options.clientId ?? null,
    })
    .returning({ id: memberships.id });
  const [role] = await database
    .select()
    .from(roles)
    .where(and(eq(roles.tenantId, tenant.id), eq(roles.key, roleKey)));
  if (!m || !role) throw new Error("member setup failed");
  await database.insert(memberRoles).values({ membershipId: m.id, roleId: role.id });
  await bumpPermissionsVersion(database, tenant.id);
  const result = await buildTenantContext(database, slug, userId, false);
  if (!result.ok) throw new Error("context failed");
  return { userId, membershipId: m.id, ctx: result.ctx };
}
