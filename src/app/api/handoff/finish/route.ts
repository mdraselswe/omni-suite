import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/server/auth/auth";
import { HANDOFF_COOKIE, HANDOFF_COOKIE_PATH } from "@/server/auth/handoff-browser";
import { safeNextPath } from "@/server/auth/redirect";
import { requestHost, slugForHost } from "@/server/tenancy/hosts";

/** Redirect that also drops the one-time browser nonce (finished or not). */
function redirectClearing(url: URL): NextResponse {
  const response = NextResponse.redirect(url);
  response.cookies.set(HANDOFF_COOKIE, "", { path: HANDOFF_COOKIE_PATH, maxAge: 0, httpOnly: true });
  return response;
}

/**
 * Runs on the custom domain: redeems the one-time token (server-side only) for a
 * NEW session bound to this domain's business, and sets its cookie on this host.
 * The token only works together with the nonce cookie this browser got from the
 * domain's /login, so nobody can sign a visitor into their own account (login CSRF).
 */
export async function GET(request: NextRequest) {
  const h = await headers();
  const host = requestHost(h);
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const origin = request.nextUrl.origin;
  const browser = request.cookies.get(HANDOFF_COOKIE)?.value ?? "";
  const home = new URL("/", origin);
  if (!token || !browser || !(await slugForHost(host))) return redirectClearing(home);

  try {
    const result = await getAuth().api.redeemHandoff({
      body: { token, host, browser },
      headers: h,
      asResponse: true,
    });
    if (!result.ok) return redirectClearing(home);
    const response = redirectClearing(new URL(next, origin));
    for (const cookie of result.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    return response;
  } catch {
    return redirectClearing(home);
  }
}
