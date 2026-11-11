// @vitest-environment node
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));
vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_platformkey123456");
vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_platformsecret123");
vi.stubEnv("STRIPE_PRICE_STARTER", "price_starter");
vi.stubEnv("STRIPE_PRICE_GROWTH", "price_growth");
vi.stubEnv("STRIPE_PRICE_SCALE", "price_scale");

let database: Database;
let ctx: TenantContext;

function signed(event: object) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", "whsec_platformsecret123").update(`${t}.${body}`).digest("hex");
  return { body, header: `t=${t},v1=${v1}` };
}

const subscription = (status: string, price: string) => ({
  id: "sub_1",
  status,
  customer: "cus_1",
  cancel_at_period_end: false,
  items: { data: [{ price: { id: price }, current_period_end: 1_900_000_000 }] },
});

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "bill"));
});

describe("subscription billing", () => {
  it("limits team seats to the first plan until the business subscribes", async () => {
    const { createInvitation, listRoles } = await import("@/features/team");
    const staff = (await listRoles(database, ctx.tenant.id)).find((r) => r.key === "staff")?.id ?? "";
    const invite = (email: string) =>
      createInvitation(database, ctx, { email, kind: "internal", clientId: null, roleIds: [staff] });
    // Starter allows 3: the owner plus two invitations.
    await invite("a@example.com");
    await invite("b@example.com");
    await expect(invite("c@example.com")).rejects.toThrow(/3 team members/);
  });

  it("stores the subscription from a signed webhook and moves the business to that plan", async () => {
    const { billingView, handlePlatformWebhook, assertSeatAvailable } = await import("./service");
    const { tenants } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const fetchSub = vi.fn(async () => subscription("trialing", "price_growth"));
    const done = signed({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { mode: "subscription", client_reference_id: ctx.tenant.id, subscription: "sub_1" } },
    });
    expect(
      (await handlePlatformWebhook(database, done.body, done.header.replace(/v1=./, "v1=0"), fetchSub))
        .status,
    ).toBe(400);
    expect(await handlePlatformWebhook(database, done.body, done.header, fetchSub)).toEqual({
      status: 200,
      note: "subscribed",
    });
    const [row] = await database.select().from(tenants).where(eq(tenants.id, ctx.tenant.id));
    expect(row?.plan).toBe("growth");
    const view = await billingView(database, { id: ctx.tenant.id, plan: row?.plan ?? "" });
    expect(view).toMatchObject({ status: "trialing", live: true, hasCustomer: true, everSubscribed: true });
    expect(view.currentPeriodEnd?.getTime()).toBe(1_900_000_000_000);
    // Growth allows 15, so inviting works again.
    await expect(
      assertSeatAvailable(database, { id: ctx.tenant.id, plan: "growth" }),
    ).resolves.toBeUndefined();

    // Cancelled: status follows, plan text stays, limits fall back to the first plan.
    fetchSub.mockResolvedValueOnce(subscription("canceled", "price_growth"));
    const deleted = signed({
      id: "evt_2",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", metadata: {} } },
    });
    expect((await handlePlatformWebhook(database, deleted.body, deleted.header, fetchSub)).note).toBe(
      "synced",
    );
    expect((await billingView(database, { id: ctx.tenant.id, plan: "growth" })).live).toBe(false);
  });
});
