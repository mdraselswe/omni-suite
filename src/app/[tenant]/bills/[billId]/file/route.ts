import { billAttachment } from "@/features/bills";
import { openStoredFile } from "@/features/files";
import { requireTenant } from "@/server/auth/session";
import { db } from "@/server/db";
import { hasPermission } from "@/server/tenancy/context";

/** Sends a bill's attached copy to members who can read bills (everyone else gets a 404). */
export async function GET(request: Request, { params }: RouteContext<"/[tenant]/bills/[billId]/file">) {
  const { tenant, billId } = await params;
  const ctx = await requireTenant(tenant);
  if (!hasPermission(ctx, "bills.read")) return new Response("Not found", { status: 404 });
  const file = await billAttachment(db(), ctx.tenant.id, billId);
  if (!file) return new Response("Not found", { status: 404 });
  // Streamed from disk: a large upload is never held in memory.
  const stored = await openStoredFile(file.key);
  if (!stored) return new Response("Not found", { status: 404 });
  const inline =
    new URL(request.url).searchParams.has("view") &&
    /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(file.mime);
  return new Response(stored.stream, {
    headers: {
      "content-type": inline ? file.mime : "application/octet-stream",
      "content-length": String(stored.size),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, no-store",
    },
  });
}
