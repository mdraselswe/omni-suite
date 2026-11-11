import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { actionContext } from "@/server/auth/session";
import { sign } from "@/server/crypto";
import { xeroAuthUrl, xeroConfigured } from "@/server/xero";

/** Starts Xero consent for a business (owner with integrations.manage). */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("tenant") ?? "";
  const appUrl = serverEnv().APP_URL;
  try {
    const { ctx } = await actionContext(slug, "integrations.manage", "all");
    if (!xeroConfigured()) {
      return NextResponse.redirect(new URL(`/${ctx.tenant.slug}/settings/xero/?error=config`, appUrl));
    }
    const state = sign({ tenantId: ctx.tenant.id, slug: ctx.tenant.slug, userId: ctx.user.id });
    return NextResponse.redirect(xeroAuthUrl(state));
  } catch {
    return NextResponse.redirect(new URL("/", appUrl));
  }
}
