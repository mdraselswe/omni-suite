import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/server/auth/auth";
import { cleanHost, slugForHost } from "@/server/tenancy/hosts";

/** Runs on the custom domain: trades the one-time token for a session cookie on this host. */
export async function GET(request: NextRequest) {
  const h = await headers();
  const host = cleanHost(h.get("x-forwarded-host") ?? h.get("host"));
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const nextParam = request.nextUrl.searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const origin = request.nextUrl.origin;
  if (!token || !(await slugForHost(host))) return NextResponse.redirect(new URL("/", origin));

  try {
    const result = await getAuth().api.verifyOneTimeToken({ body: { token }, headers: h, asResponse: true });
    if (!result.ok) return NextResponse.redirect(new URL("/login/", origin));
    const response = NextResponse.redirect(new URL(next, origin));
    for (const cookie of result.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login/", origin));
  }
}
