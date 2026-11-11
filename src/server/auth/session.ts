import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/server/db";
import {
  ForbiddenError,
  requirePermission,
  withModuleGates,
  type TenantContext,
} from "@/server/tenancy/context";
import { buildTenantContext } from "@/server/tenancy/service";
import type { Scope } from "@/server/rbac/resolve";
import { getAuth, isPlatformAdmin } from "./auth";
import { boundTenantOf } from "./handoff-access";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
};

/**
 * The signed-in user plus, for a session made by the custom-domain handoff, the
 * one business it is bound to. Deduplicated per request.
 */
export const getRequestSession = cache(
  async (): Promise<{ user: SessionUser; boundTenant: string | null } | null> => {
    const result = await getAuth().api.getSession({ headers: await headers() });
    if (!result) return null;
    const { id, name, email, emailVerified, image } = result.user;
    const boundTenant = await boundTenantOf(db(), result.session);
    return { user: { id, name, email, emailVerified, image: image ?? null }, boundTenant };
  },
);

/**
 * The signed-in user for account-wide pages (home, onboarding, invitations,
 * account), or null. A business-bound session doesn't count here.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const current = await getRequestSession();
  return current && !current.boundTenant ? current.user : null;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isPlatformAdmin(user)) notFound();
  return user;
}

/** Tenant context for pages and actions. Redirects or 404s when not allowed. */
export const requireTenant = cache(async (slug: string): Promise<TenantContext> => {
  const current = await getRequestSession();
  if (!current) redirect("/login");
  if (current.boundTenant && current.boundTenant !== slug) notFound();
  const platformAdmin = !current.boundTenant && isPlatformAdmin(current.user);
  const result = await buildTenantContext(db(), slug, current.user.id, platformAdmin);
  if (!result.ok) {
    if (result.reason === "suspended") redirect("/suspended");
    notFound();
  }
  return withModuleGates(result.ctx);
});

/** Tenant context plus a permission check (404 for pages: we don't reveal what exists). */
export async function requireTenantPermission(
  slug: string,
  permission: string,
  minimum: Scope = "own",
): Promise<{ ctx: TenantContext; scope: Scope }> {
  const ctx = await requireTenant(slug);
  try {
    return { ctx, scope: requirePermission(ctx, permission, minimum) };
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
}

/** For Server Actions: tenant context plus a permission check that throws ForbiddenError (shown as a toast). */
export async function actionContext(
  slug: string,
  permission: string,
  minimum: Scope = "own",
): Promise<{ ctx: TenantContext; scope: Scope }> {
  const ctx = await requireTenant(slug);
  return { ctx, scope: requirePermission(ctx, permission, minimum) };
}
