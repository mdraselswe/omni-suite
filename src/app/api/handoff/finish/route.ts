import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/server/auth/auth";
import { safeNextPath } from "@/server/auth/redirect";
import { requestHost, slugForHost } from "@/server/tenancy/hosts";

/**
 * Runs on the custom domain: redeems the one-time token (server-side only) for a
 * NEW session bound to this domain's business, and sets its cookie on this host.
 */
export async function GET(request: NextRequest) {
  const h = await headers();
  const host = requestHost(h);
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const origin = request.nextUrl.origin;
  if (!token || !(await slugForHost(host))) return NextResponse.redirect(new URL("/", origin));

  try {
    const result = await getAuth().api.redeemHandoff({ body: { token, host }, headers: h, asResponse: true });
    if (!result.ok) return NextResponse.redirect(new URL("/", origin));
    const response = NextResponse.redirect(new URL(next, origin));
    for (const cookie of result.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    return response;
  } catch {
    return NextResponse.redirect(new URL("/", origin));
  }
}
