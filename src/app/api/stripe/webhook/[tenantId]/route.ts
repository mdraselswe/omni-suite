import { NextResponse, type NextRequest } from "next/server";
import { handleTenantWebhook } from "@/features/payments";
import { db } from "@/server/db";

/**
 * A business's Stripe account calls this when a client pays an invoice online.
 * The URL is shown in Settings → Online payments. The signature is checked with
 * that business's own webhook secret.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/api/stripe/webhook/[tenantId]">) {
  const { tenantId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const result = await handleTenantWebhook(
    db(),
    tenantId,
    await request.text(),
    request.headers.get("stripe-signature"),
  );
  return NextResponse.json({ received: result.status === 200, note: result.note }, { status: result.status });
}
