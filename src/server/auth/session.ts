import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/server/db";
import { ForbiddenError, requirePermission, type TenantContext } from "@/server/tenancy/context";
import { buildTenantContext } from "@/server/tenancy/service";
import type { Scope } from "@/server/rbac/resolve";
import { getAuth, isPlatformAdminEmail } from "./auth";

export type SessionUser = { id: string; name: string; email: string; image: string | null };

/** The signed-in user for this request, or null. Deduplicated per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const result = await getAuth().api.getSession({ headers: await headers() });
  if (!result) return null;
  const { id, name, email, image } = result.user;
  return { id, name, email, image: image ?? null };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isPlatformAdminEmail(user.email)) notFound();
  return user;
}

/** Tenant context for pages and actions. Redirects or 404s when not allowed. */
export const requireTenant = cache(async (slug: string): Promise<TenantContext> => {
  const user = await requireUser();
  const result = await buildTenantContext(db(), slug, user.id, isPlatformAdminEmail(user.email));
  if (!result.ok) {
    if (result.reason === "suspended") redirect("/suspended");
    notFound();
  }
  return result.ctx;
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
