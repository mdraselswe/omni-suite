import { fileForDownload, openStoredFile } from "@/features/files";
import { requireTenant } from "@/server/auth/session";
import { db } from "@/server/db";
import { ForbiddenError, requirePermission } from "@/server/tenancy/context";

/** Sends a stored file to members allowed to see it (clients: shared files of their own client only). */
export async function GET(request: Request, { params }: RouteContext<"/api/t/[tenant]/files/[id]">) {
  const { tenant, id } = await params;
  const ctx = await requireTenant(tenant);
  let scope;
  try {
    scope = requirePermission(ctx, ctx.membership.kind === "client" ? "portal.files" : "files.read");
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Not found", { status: 404 });
    throw error;
  }
  const file = await fileForDownload(db(), ctx, scope, id);
  if (!file) return new Response("Not found", { status: 404 });
  // Streamed from disk: a large upload is never held in memory.
  const stored = await openStoredFile(file.storageKey);
  if (!stored) return new Response("Not found", { status: 404 });
  const inline =
    new URL(request.url).searchParams.has("view") &&
    /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(file.mime);
  const filename = encodeURIComponent(file.name);
  return new Response(stored.stream, {
    headers: {
      "content-type": inline ? file.mime : "application/octet-stream",
      "content-length": String(stored.size),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${filename}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, no-store",
    },
  });
}
