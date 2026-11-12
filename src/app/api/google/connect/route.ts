import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { canBackUpEverything } from "@/features/backup";
import { actionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { driveAuthUrl, googleConfigured } from "@/server/google";
import { startOAuth } from "@/server/oauth-state";

/**
 * Starts the Google Drive consent for a tenant's backup (drive.file scope only).
 * A Drive backup copies everything, so it needs the full-backup right (owner, or
 * someone who can already export every data set).
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("tenant") ?? "";
  const appUrl = serverEnv().APP_URL;
  try {
    const { ctx } = await actionContext(slug, "backup.manage", "all");
    if (!(await canBackUpEverything(db(), ctx))) return NextResponse.redirect(new URL("/", appUrl));
    if (!googleConfigured()) {
      return NextResponse.redirect(new URL(`/${ctx.tenant.slug}/settings/backup/?error=config`, appUrl));
    }
    const { state, cookie } = await startOAuth(db(), "google-backup", {
      tenantId: ctx.tenant.id,
      slug: ctx.tenant.slug,
      userId: ctx.user.id,
    });
    const response = NextResponse.redirect(driveAuthUrl(state));
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch {
    return NextResponse.redirect(new URL("/", appUrl));
  }
}
