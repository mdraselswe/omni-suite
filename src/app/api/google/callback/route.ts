import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { saveConnection } from "@/features/backup";
import { getSessionUser } from "@/server/auth/session";
import { verifySigned } from "@/server/crypto";
import { db } from "@/server/db";
import { exchangeCode } from "@/server/google";

type State = { tenantId: string; slug: string; userId: string };

/** Google redirects here after consent. The signed state ties it to the tenant and the user who started it. */
export async function GET(request: NextRequest) {
  const appUrl = serverEnv().APP_URL;
  const state = verifySigned<State>(request.nextUrl.searchParams.get("state") ?? "");
  const code = request.nextUrl.searchParams.get("code");
  const user = await getSessionUser();
  if (!state || !user || user.id !== state.userId) return NextResponse.redirect(new URL("/", appUrl));
  const back = new URL(`/${state.slug}/settings/backup/`, appUrl);
  if (!code) {
    back.searchParams.set("error", "denied");
    return NextResponse.redirect(back);
  }
  try {
    const { refreshToken, email } = await exchangeCode(code);
    await saveConnection(db(), { tenantId: state.tenantId, userId: user.id, refreshToken, email });
  } catch (error) {
    console.error("[google] callback failed", error);
    back.searchParams.set("error", "failed");
  }
  return NextResponse.redirect(back);
}
