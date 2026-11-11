import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { cleanHost, isAppHost, slugForHost } from "@/server/tenancy/hosts";

/**
 * Custom domains (ADR 0004). On a verified tenant domain:
 * - "/" opens that business (rewritten to /<slug>/);
 * - "/login" sends the visitor to the app host to sign in, then hands the
 *   session back with a one-time token (/api/handoff/*);
 * - every other path works as on the app host.
 * The app host itself passes straight through without any lookup.
 */
export async function proxy(request: NextRequest) {
  const host = cleanHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  if (isAppHost(host)) return NextResponse.next();

  const slug = await slugForHost(host);
  if (!slug) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname === "/" || pathname === "") {
    const url = request.nextUrl.clone();
    url.pathname = `/${slug}/`;
    return NextResponse.rewrite(url);
  }
  if (pathname === "/login" || pathname === "/login/") {
    const next = request.nextUrl.searchParams.get("next") ?? "/";
    const start = new URL("/api/handoff/start/", serverEnv().APP_URL);
    start.searchParams.set("host", host);
    start.searchParams.set("next", next);
    return NextResponse.redirect(start);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/|api/|favicon|icon|apple-icon|manifest|sw\\.js|.*\\.(?:png|svg|jpg|jpeg|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
