import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { canBackUpEverything, saveConnection } from "@/features/backup";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { exchangeCode } from "@/server/google";
import { clearOAuthCookie, finishOAuth, oauthCookie } from "@/server/oauth-state";

function redirect(url: URL): NextResponse {
  const response = NextResponse.redirect(url);
  const clear = clearOAuthCookie("google-backup");
  response.cookies.set(clear.name, clear.value, clear.options);
  return response;
}

/**
 * Google redirects here after consent. The state must be this browser's own,
 * unused, Google-backup state, and the user must still hold the full-backup right.
 */
export async function GET(request: NextRequest) {
  const appUrl = serverEnv().APP_URL;
  const home = new URL("/", appUrl);
  const state = await finishOAuth(
    db(),
    "google-backup",
    request.nextUrl.searchParams.get("state") ?? "",
    request.cookies.get(oauthCookie("google-backup").name)?.value,
  );
  if (!state) return redirect(home);
  let allowed = false;
  try {
    const { ctx } = await actionContext(state.slug, "backup.manage", "all");
    allowed =
      ctx.tenant.id === state.tenantId &&
      ctx.user.id === state.userId &&
      (await canBackUpEverything(db(), ctx));
  } catch {
    allowed = false;
  }
  if (!allowed) return redirect(home);

  const back = new URL(`/${state.slug}/settings/backup/`, appUrl);
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    back.searchParams.set("error", "denied");
    return redirect(back);
  }
  try {
    const { refreshToken, email } = await exchangeCode(code);
    await saveConnection(db(), { tenantId: state.tenantId, userId: state.userId, refreshToken, email });
  } catch (error) {
    console.error("[google] callback failed", error);
    back.searchParams.set("error", "failed");
  }
  return redirect(back);
}
