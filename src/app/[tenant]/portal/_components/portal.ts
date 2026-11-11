import "server-only";
import { notFound } from "next/navigation";
import { requireTenantPermission } from "@/server/auth/session";

/**
 * Portal page guard: a client member with the permission and a linked client.
 * Everything below the portal is scoped to this clientId; staff get a 404.
 */
export async function portalPage(slug: string, permission: string) {
  const { ctx } = await requireTenantPermission(slug, permission);
  const clientId = ctx.membership.clientId;
  if (ctx.membership.kind !== "client" || !clientId) notFound();
  return { ctx, clientId };
}
