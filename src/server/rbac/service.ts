import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { t } from "@/i18n";
import { defaultRoleTemplates, permissionDef, type DefaultRoleKey } from "@/modules/catalog";
import type { DbOrTx } from "@/server/db";
import {
  memberOverrides,
  memberRoles,
  memberships,
  rolePermissions,
  roles,
  tenants,
} from "@/server/db/schema";
import { resolvePermissions, type Grant, type Override, type Scope } from "./resolve";

/** Creates the default roles for a new tenant. Returns role ids by key. */
export async function seedDefaultRoles(
  tx: DbOrTx,
  tenantId: string,
): Promise<Record<DefaultRoleKey, string>> {
  const ids = {} as Record<DefaultRoleKey, string>;
  for (const template of defaultRoleTemplates()) {
    const [role] = await tx
      .insert(roles)
      .values({
        tenantId,
        key: template.key,
        name: t(template.name),
        description: t(template.description),
        audience: template.audience,
        isSystem: true,
      })
      .returning({ id: roles.id });
    if (!role) throw new Error("Role insert failed");
    ids[template.key] = role.id;
    if (template.grants.length > 0) {
      await tx.insert(rolePermissions).values(template.grants.map((g) => ({ roleId: role.id, ...g })));
    }
  }
  return ids;
}

/** Restores a system role to its default permissions. */
export async function resetRoleToDefault(tx: DbOrTx, tenantId: string, roleId: string): Promise<void> {
  const [role] = await tx
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));
  const template = defaultRoleTemplates().find((r) => r.key === role?.key);
  if (!role || !role.isSystem || !template) throw new Error("Not a system role");
  await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (template.grants.length > 0) {
    await tx.insert(rolePermissions).values(template.grants.map((g) => ({ roleId, ...g })));
  }
  await bumpPermissionsVersion(tx, tenantId);
}

export async function bumpPermissionsVersion(tx: DbOrTx, tenantId: string): Promise<void> {
  await tx
    .update(tenants)
    .set({ permissionsVersion: sql`${tenants.permissionsVersion} + 1` })
    .where(eq(tenants.id, tenantId));
}

type CacheEntry = { version: number; at: number; perms: Map<string, Scope> };
const cache = new Map<string, CacheEntry>();
const MAX_AGE_MS = 60_000;

/**
 * Effective permissions of a membership. Cached in memory per membership and
 * tenant permissions version (ADR 0005); a short max age covers expiring overrides.
 */
export async function loadPermissions(
  database: DbOrTx,
  membershipId: string,
  permissionsVersion: number,
): Promise<Map<string, Scope>> {
  const hit = cache.get(membershipId);
  if (hit && hit.version === permissionsVersion && Date.now() - hit.at < MAX_AGE_MS) return hit.perms;

  const [grantRows, overrideRows, member] = await Promise.all([
    database
      .select({
        permission: rolePermissions.permission,
        scope: rolePermissions.scope,
        audience: roles.audience,
      })
      .from(memberRoles)
      .innerJoin(roles, eq(roles.id, memberRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(eq(memberRoles.membershipId, membershipId)),
    database
      .select({
        permission: memberOverrides.permission,
        effect: memberOverrides.effect,
        scope: memberOverrides.scope,
        expiresAt: memberOverrides.expiresAt,
      })
      .from(memberOverrides)
      .where(eq(memberOverrides.membershipId, membershipId)),
    database.select({ kind: memberships.kind }).from(memberships).where(eq(memberships.id, membershipId)),
  ]);

  const kind = member[0]?.kind ?? "client";
  // Defence in depth: a member only ever gets permissions of their own audience.
  const fitsAudience = (permission: string) => permissionDef(permission)?.audience === kind;
  const grants: Grant[] = grantRows.filter((g) => fitsAudience(g.permission));
  const overrides: Override[] = overrideRows.filter((o) => fitsAudience(o.permission));
  const perms = resolvePermissions({ roleGrants: grants, overrides });
  cache.set(membershipId, { version: permissionsVersion, at: Date.now(), perms });
  return perms;
}

/** Test helper. */
export function clearPermissionCache(): void {
  cache.clear();
}

/** Role ids of a membership. */
export async function memberRoleIds(database: DbOrTx, membershipId: string): Promise<string[]> {
  const rows = await database
    .select({ roleId: memberRoles.roleId })
    .from(memberRoles)
    .where(eq(memberRoles.membershipId, membershipId));
  return rows.map((r) => r.roleId);
}

/** Members (ids) holding the owner role in a tenant. */
export async function ownerMembershipIds(database: DbOrTx, tenantId: string): Promise<string[]> {
  const rows = await database
    .select({ membershipId: memberRoles.membershipId })
    .from(memberRoles)
    .innerJoin(roles, eq(roles.id, memberRoles.roleId))
    .innerJoin(memberships, eq(memberships.id, memberRoles.membershipId))
    .where(and(eq(roles.tenantId, tenantId), eq(roles.key, "owner"), eq(memberships.status, "active")));
  return rows.map((r) => r.membershipId);
}

export async function rolesByIds(database: DbOrTx, tenantId: string, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return database
    .select()
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), inArray(roles.id, [...ids])));
}
