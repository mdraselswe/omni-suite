import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { getAuth } from "@/server/auth/auth";
import { cleanHost, slugForHost } from "@/server/tenancy/hosts";

function safePath(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

/** Runs on the app host: signs the user in here, then sends a one-time token to the custom domain. */
export async function GET(request: NextRequest) {
  const host = cleanHost(request.nextUrl.searchParams.get("host"));
  const next = safePath(request.nextUrl.searchParams.get("next"));
  const appUrl = serverEnv().APP_URL;
  if (!(await slugForHost(host))) return NextResponse.redirect(new URL("/", appUrl));

  const auth = getAuth();
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) {
    const back = `/api/handoff/start/?${new URLSearchParams({ host, next }).toString()}`;
    return NextResponse.redirect(new URL(`/login/?next=${encodeURIComponent(back)}`, appUrl));
  }
  const { token } = await auth.api.generateOneTimeToken({ headers: h });
  const target = new URL("/api/handoff/finish/", `${new URL(appUrl).protocol}//${host}`);
  target.searchParams.set("token", token);
  target.searchParams.set("next", next);
  return NextResponse.redirect(target);
}
