import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { saveXeroConnection } from "@/features/xero";
import { getSessionUser } from "@/server/auth/session";
import { verifySigned } from "@/server/crypto";
import { db } from "@/server/db";
import { exchangeCode, listConnections } from "@/server/xero";

type State = { tenantId: string; slug: string; userId: string };

/** Xero redirects here after consent. The signed state ties it to the business and the user who started it. */
export async function GET(request: NextRequest) {
  const appUrl = serverEnv().APP_URL;
  const state = verifySigned<State>(request.nextUrl.searchParams.get("state") ?? "");
  const code = request.nextUrl.searchParams.get("code");
  const user = await getSessionUser();
  if (!state || !user || user.id !== state.userId) return NextResponse.redirect(new URL("/", appUrl));
  const back = new URL(`/${state.slug}/settings/xero/`, appUrl);
  if (!code) {
    back.searchParams.set("error", "denied");
    return NextResponse.redirect(back);
  }
  try {
    const tokens = await exchangeCode(code);
    const org = (await listConnections(tokens.accessToken)).find((c) => c.tenantType === "ORGANISATION");
    if (!org) {
      back.searchParams.set("error", "noorg");
      return NextResponse.redirect(back);
    }
    await saveXeroConnection(db(), {
      tenantId: state.tenantId,
      userId: user.id,
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
  return NextResponse.redirect(back);
}
