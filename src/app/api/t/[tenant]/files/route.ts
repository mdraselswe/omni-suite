import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { parseUploadForm, uploadFile } from "@/features/files";
import { t } from "@/i18n";
import { errorState, type ActionState } from "@/server/action";
import { actionContext, getRequestSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { cleanHost, requestHost } from "@/server/tenancy/hosts";

/** Room for multipart boundaries and the other form fields. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return cleanHost(new URL(origin).host) === requestHost(request.headers);
  } catch {
    return false;
  }
}

function answer(state: ActionState, status = 200): NextResponse {
  return NextResponse.json(state, { status, headers: { "cache-control": "no-store" } });
}

/**
 * File uploads (staff and client portal). A route handler rather than a Server
 * Action so only this endpoint accepts large bodies (MAX_UPLOAD_MB); Server
 * Actions keep a small limit. Answers with the same shape as a form action.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/api/t/[tenant]/files">) {
  const { tenant } = await params;
  // Same-origin only, like a Server Action (no cross-site form posts).
  if (!sameOrigin(request)) {
    return answer({ ok: false, message: t("form.forbidden") }, 403);
  }
  const maxBytes = serverEnv().MAX_UPLOAD_MB * 1024 * 1024;
  const length = Number(request.headers.get("content-length") ?? "");
  if (!Number.isFinite(length) || length <= 0 || length > maxBytes + FORM_OVERHEAD_BYTES) {
    return answer({ ok: false, message: t("files.tooLarge", { mb: serverEnv().MAX_UPLOAD_MB }) }, 413);
  }
  if (!(await getRequestSession())) return answer({ ok: false, message: t("form.forbidden") }, 401);
  try {
    const { ctx } = await actionContext(tenant, "portal.files").catch(() =>
      actionContext(tenant, "files.write"),
    );
    await uploadFile(db(), ctx, parseUploadForm(await request.formData()));
    return answer({ ok: true, message: t("form.saved"), at: Date.now() });
  } catch (error) {
    unstable_rethrow(error);
    return answer(errorState(error), 400);
  }
}
