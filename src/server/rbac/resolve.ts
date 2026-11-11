/**
 * Pure permission resolution. No database access here, so it is easy to test.
 *
 * Effective permissions = union of all role grants
 *   + allow overrides (not expired)
 *   − deny overrides (not expired; a deny always wins).
 * A permission is held with the widest scope any source gives it.
 */

export const SCOPES = ["own", "assigned", "all"] as const;
export type Scope = (typeof SCOPES)[number];

export type Grant = { permission: string; scope: Scope };
export type Override = {
  permission: string;
  effect: "allow" | "deny";
  scope: Scope;
  expiresAt: Date | null;
};

export type EffectivePermissions = ReadonlyMap<string, Scope>;

const rank: Record<Scope, number> = { own: 0, assigned: 1, all: 2 };

export function widerScope(a: Scope, b: Scope): Scope {
  return rank[a] >= rank[b] ? a : b;
}

export function scopeCovers(held: Scope, needed: Scope): boolean {
  return rank[held] >= rank[needed];
}

export function resolvePermissions(input: {
  roleGrants: readonly Grant[];
  overrides: readonly Override[];
  now?: Date;
}): Map<string, Scope> {
  const now = input.now ?? new Date();
  const result = new Map<string, Scope>();
  const add = (permission: string, scope: Scope) => {
    const current = result.get(permission);
    result.set(permission, current ? widerScope(current, scope) : scope);
  };
  for (const grant of input.roleGrants) add(grant.permission, grant.scope);
  const active = input.overrides.filter((o) => o.expiresAt === null || o.expiresAt > now);
  for (const o of active) if (o.effect === "allow") add(o.permission, o.scope);
  for (const o of active) if (o.effect === "deny") result.delete(o.permission);
  return result;
}

/** Does the member hold `permission` with at least `scope`? */
export function can(perms: EffectivePermissions, permission: string, scope: Scope = "own"): boolean {
  const held = perms.get(permission);
  return held !== undefined && scopeCovers(held, scope);
}

/**
 * Privilege-escalation guard: a member may only hand out permissions they hold
 * themselves, with at most their own scope.
 */
export function canGrant(granter: EffectivePermissions, permission: string, scope: Scope): boolean {
  return can(granter, permission, scope);
}
