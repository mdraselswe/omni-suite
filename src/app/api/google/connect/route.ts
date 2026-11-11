import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { actionContext } from "@/server/auth/session";
import { sign } from "@/server/crypto";
import { driveAuthUrl, googleConfigured } from "@/server/google";

/** Starts the Google Drive consent for a tenant's backup (drive.file scope only). */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("tenant") ?? "";
  const appUrl = serverEnv().APP_URL;
  try {
    const { ctx } = await actionContext(slug, "backup.manage", "all");
    if (!googleConfigured()) {
      return NextResponse.redirect(new URL(`/${ctx.tenant.slug}/settings/backup/?error=config`, appUrl));
    }
    const state = sign({ tenantId: ctx.tenant.id, slug: ctx.tenant.slug, userId: ctx.user.id });
    return NextResponse.redirect(driveAuthUrl(state));
  } catch {
    return NextResponse.redirect(new URL("/", appUrl));
  }
}
