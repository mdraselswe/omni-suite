import { NextResponse, type NextRequest } from "next/server";
import { handlePlatformWebhook } from "@/features/billing";
import { db } from "@/server/db";

/** The platform's Stripe account calls this for OmniSuite subscriptions (Settings → Subscription). */
export async function POST(request: NextRequest) {
  const result = await handlePlatformWebhook(
    db(),
    await request.text(),
    request.headers.get("stripe-signature"),
  );
  return NextResponse.json({ received: result.status === 200, note: result.note }, { status: result.status });
}
