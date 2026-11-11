// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";

let database: Database;
let ownerId: string;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ownerId } = await setupTenant(database, "hand"));
  await setupTenant(database, "other");
});

describe("custom-domain handoff", () => {
  it("mints tokens only for active members of the domain's business", async () => {
    const { addMember, createUser } = await import("@/server/testing/db");
    const { createHandoffToken, isActiveMember, memberBusinessName } = await import("./handoff-access");
    const { memberships } = await import("@/server/db/schema");
    const outsider = await createUser(database, "Outsider", "outsider@example.com");
    const { userId: staffId, membershipId } = await addMember(database, "hand", "staff", "Sam Staff");

    expect(await memberBusinessName(database, ownerId, "hand")).toBe("Biz hand");
    expect(await isActiveMember(database, ownerId, "other")).toBe(false);
    // An attacker-controlled domain of another business can't get a token for this user.
    expect(
      await createHandoffToken(database, { userId: ownerId, host: "evil.test", slug: "other" }),
    ).toBeNull();
    expect(
      await createHandoffToken(database, { userId: outsider, host: "shop.test", slug: "hand" }),
    ).toBeNull();
    expect(await createHandoffToken(database, { userId: staffId, host: "shop.test", slug: "hand" })).toEqual(
      expect.any(String),
    );

    await database.update(memberships).set({ status: "disabled" }).where(eq(memberships.id, membershipId));
    expect(
      await createHandoffToken(database, { userId: staffId, host: "shop.test", slug: "hand" }),
    ).toBeNull();
  });

  it("redeems a token once, only on its own host, before it expires", async () => {
    const { createHandoffToken, redeemHandoffToken } = await import("./handoff-access");
    const { verification } = await import("@/server/db/schema");
    const grant = { userId: ownerId, host: "shop.test", slug: "hand" };

    const wrongHost = await createHandoffToken(database, grant);
    expect(await redeemHandoffToken(database, wrongHost ?? "", "evil.test")).toBeNull();
    // A failed attempt still burns the token.
    expect(await redeemHandoffToken(database, wrongHost ?? "", "shop.test")).toBeNull();

    const token = await createHandoffToken(database, grant);
    expect(await redeemHandoffToken(database, token ?? "", "shop.test")).toEqual(grant);
    expect(await redeemHandoffToken(database, token ?? "", "shop.test")).toBeNull();
    expect(await redeemHandoffToken(database, "made-up", "shop.test")).toBeNull();

    const late = await createHandoffToken(database, grant);
    await database.update(verification).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await redeemHandoffToken(database, late ?? "", "shop.test")).toBeNull();
  });

  it("remembers which business a handoff session belongs to and keeps the binding alive", async () => {
    const { bindSessionToTenant, boundTenantOf } = await import("./handoff-access");
    const { verification } = await import("@/server/db/schema");
    const expiresAt = new Date(Date.now() + 30 * 86_400_000);
    expect(await boundTenantOf(database, { id: "plain-session", expiresAt })).toBeNull();

    await bindSessionToTenant(database, "bound-session", "hand", expiresAt);
    expect(await boundTenantOf(database, { id: "bound-session", expiresAt })).toBe("hand");

    // The session was refreshed far beyond the binding: the binding is pushed forward, never dropped.
    const refreshed = new Date(Date.now() + 365 * 86_400_000);
    expect(await boundTenantOf(database, { id: "bound-session", expiresAt: refreshed })).toBe("hand");
    const [row] = await database
      .select()
      .from(verification)
      .where(eq(verification.identifier, "session-tenant:bound-session"));
    expect(row && row.expiresAt > refreshed).toBe(true);
  });
});
