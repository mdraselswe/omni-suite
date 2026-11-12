import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { startOAuth } from "@/server/oauth-state";
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
    const { state, cookie } = await startOAuth(db(), "xero", {
      tenantId: ctx.tenant.id,
      slug: ctx.tenant.slug,
      userId: ctx.user.id,
    });
    const response = NextResponse.redirect(xeroAuthUrl(state));
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch {
    return NextResponse.redirect(new URL("/", appUrl));
  }
}
