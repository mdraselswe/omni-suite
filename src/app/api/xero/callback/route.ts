import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { saveXeroConnection } from "@/features/xero";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { clearOAuthCookie, finishOAuth, oauthCookie } from "@/server/oauth-state";
import { exchangeCode, listConnections } from "@/server/xero";

function redirect(url: URL): NextResponse {
  const response = NextResponse.redirect(url);
  const clear = clearOAuthCookie("xero");
  response.cookies.set(clear.name, clear.value, clear.options);
  return response;
}

/**
 * Xero redirects here after consent. The state must be this browser's own,
 * unused, Xero state, and the user must still hold integrations.manage there.
 */
export async function GET(request: NextRequest) {
  const appUrl = serverEnv().APP_URL;
  const home = new URL("/", appUrl);
  const state = await finishOAuth(
    db(),
    "xero",
    request.nextUrl.searchParams.get("state") ?? "",
    request.cookies.get(oauthCookie("xero").name)?.value,
  );
  if (!state) return redirect(home);
  let allowed = false;
  try {
    const { ctx } = await actionContext(state.slug, "integrations.manage", "all");
    allowed = ctx.tenant.id === state.tenantId && ctx.user.id === state.userId;
  } catch {
    allowed = false;
  }
  if (!allowed) return redirect(home);

  const back = new URL(`/${state.slug}/settings/xero/`, appUrl);
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    back.searchParams.set("error", "denied");
    return redirect(back);
  }
  try {
    const tokens = await exchangeCode(code);
    const org = (await listConnections(tokens.accessToken)).find((c) => c.tenantType === "ORGANISATION");
    if (!org) {
      back.searchParams.set("error", "noorg");
      return redirect(back);
    }
    await saveXeroConnection(db(), {
      tenantId: state.tenantId,
      userId: state.userId,
      xeroTenantId: org.tenantId,
      xeroTenantName: org.tenantName,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    });
  } catch (error) {
    console.error("[xero] callback failed", error);
    back.searchParams.set("error", "failed");
  }
  return redirect(back);
}
