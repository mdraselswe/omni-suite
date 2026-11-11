import type { TenantSettings } from "@/lib/tenant-settings";
import { moduleOfPermission } from "@/modules/catalog";
import type { EffectivePermissions, Scope } from "@/server/rbac/resolve";

/** Everything a request inside a tenant needs. Built once per request. */
export type TenantContext = {
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: "active" | "suspended";
    plan: string;
    settings: TenantSettings;
  };
  user: { id: string; name: string; email: string; image: string | null };
  membership: {
    id: string;
    kind: "internal" | "client";
    clientId: string | null;
    title: string;
  };
  permissions: EffectivePermissions;
  isPlatformAdmin: boolean;
};

export class ForbiddenError extends Error {
  constructor(public readonly permission: string) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

/** Scope the member holds for a permission, or throws ForbiddenError. */
export function requirePermission(ctx: TenantContext, permission: string, minimum: Scope = "own"): Scope {
  const mod = moduleOfPermission(permission);
  if (mod?.optional && ctx.tenant.settings.disabledModules.includes(mod.key))
    throw new ForbiddenError(permission);
  const held = ctx.permissions.get(permission);
  const rank = { own: 0, assigned: 1, all: 2 } as const;
  if (!held || rank[held] < rank[minimum]) throw new ForbiddenError(permission);
  return held;
}

export function hasPermission(ctx: TenantContext, permission: string, minimum: Scope = "own"): boolean {
  try {
    requirePermission(ctx, permission, minimum);
    return true;
  } catch {
    return false;
  }
}

export function isModuleEnabled(ctx: TenantContext, moduleKey: string): boolean {
  return !ctx.tenant.settings.disabledModules.includes(moduleKey);
}
