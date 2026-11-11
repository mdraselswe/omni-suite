import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { createHandoffToken } from "@/server/auth/handoff-access";
import { safeNextPath } from "@/server/auth/redirect";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { cleanHost, slugForHost } from "@/server/tenancy/hosts";

function confirmPath(host: string, next: string): string {
  return `/login/handoff/?${new URLSearchParams({ host, next }).toString()}`;
}

/**
 * Runs on the app host. GET (from the custom domain's /login) never signs
 * anyone in silently: it opens the confirmation page, which POSTs back here.
 */
export function GET(request: NextRequest) {
  const host = cleanHost(request.nextUrl.searchParams.get("host"));
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  return NextResponse.redirect(new URL(confirmPath(host, next), serverEnv().APP_URL), 303);
}

/**
 * The user confirmed. Mints a one-time token only for a verified domain of a
 * business they are an active member of, then sends it to that domain.
 */
export async function POST(request: NextRequest) {
  const appUrl = new URL(serverEnv().APP_URL);
  // Only our own confirmation page may post here (the form is same-origin).
  if (request.headers.get("origin") !== appUrl.origin) {
    return NextResponse.redirect(new URL("/", appUrl), 303);
  }
  const form = await request.formData();
  const host = cleanHost(String(form.get("host") ?? ""));
  const next = safeNextPath(form.get("next"));
  const slug = await slugForHost(host);
  if (!slug) return NextResponse.redirect(new URL("/", appUrl), 303);

  const user = await getSessionUser();
  if (!user) {
    const back = confirmPath(host, next);
    return NextResponse.redirect(new URL(`/login/?next=${encodeURIComponent(back)}`, appUrl), 303);
  }
  const token = await createHandoffToken(db(), { userId: user.id, host, slug });
  // Not a member: the confirmation page explains that.
  if (!token) return NextResponse.redirect(new URL(confirmPath(host, next), appUrl), 303);

  const target = new URL("/api/handoff/finish/", `${appUrl.protocol}//${host}`);
  target.searchParams.set("token", token);
  target.searchParams.set("next", next);
  return NextResponse.redirect(target, 303);
}
