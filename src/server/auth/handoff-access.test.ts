// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import { browserHash, cleanBrowserHash, newBrowserNonce } from "./handoff-browser";

let database: Database;
let ownerId: string;
let tenantId: string;

const nonce = newBrowserNonce();
const browser = browserHash(nonce);

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ownerId, tenantId } = await setupTenant(database, "hand"));
  await setupTenant(database, "other");
});

describe("custom-domain handoff", () => {
  it("mints tokens only for active members of the domain's business, from a browser with a nonce", async () => {
    const { addMember, createUser } = await import("@/server/testing/db");
    const { createHandoffToken, isActiveMember, memberBusinessName } = await import("./handoff-access");
    const { memberships } = await import("@/server/db/schema");
    const outsider = await createUser(database, "Outsider", "outsider@example.com");
    const { userId: staffId, membershipId } = await addMember(database, "hand", "staff", "Sam Staff");

    expect(await memberBusinessName(database, ownerId, "hand")).toBe("Biz hand");
    expect(await isActiveMember(database, ownerId, "other")).toBe(false);
    // An attacker-controlled domain of another business can't get a token for this user.
    expect(
      await createHandoffToken(database, { userId: ownerId, host: "evil.test", slug: "other", browser }),
    ).toBeNull();
    expect(
      await createHandoffToken(database, { userId: outsider, host: "shop.test", slug: "hand", browser }),
    ).toBeNull();
    // No browser nonce: the handoff wasn't started from the domain's /login.
    expect(
      await createHandoffToken(database, { userId: staffId, host: "shop.test", slug: "hand", browser: "" }),
    ).toBeNull();
    expect(
      await createHandoffToken(database, { userId: staffId, host: "shop.test", slug: "hand", browser }),
    ).toEqual(expect.any(String));

    await database.update(memberships).set({ status: "disabled" }).where(eq(memberships.id, membershipId));
    expect(
      await createHandoffToken(database, { userId: staffId, host: "shop.test", slug: "hand", browser }),
    ).toBeNull();
  });

  it("redeems a token once, only on its own host and in the browser that started it", async () => {
    const { createHandoffToken, redeemHandoffToken } = await import("./handoff-access");
    const { verification } = await import("@/server/db/schema");
    const grant = { userId: ownerId, host: "shop.test", slug: "hand", browser };

    const wrongHost = await createHandoffToken(database, grant);
    expect(await redeemHandoffToken(database, wrongHost ?? "", "evil.test", nonce)).toBeNull();
    // A failed attempt still burns the token.
    expect(await redeemHandoffToken(database, wrongHost ?? "", "shop.test", nonce)).toBeNull();

    // Login CSRF: someone else's browser (another nonce, or none) can't finish this handoff.
    const csrf = await createHandoffToken(database, grant);
    expect(await redeemHandoffToken(database, csrf ?? "", "shop.test", newBrowserNonce())).toBeNull();
    const noCookie = await createHandoffToken(database, grant);
    expect(await redeemHandoffToken(database, noCookie ?? "", "shop.test", "")).toBeNull();

    const token = await createHandoffToken(database, grant);
    expect(await redeemHandoffToken(database, token ?? "", "shop.test", nonce)).toEqual({
      ...grant,
      tenantId,
    });
    expect(await redeemHandoffToken(database, token ?? "", "shop.test", nonce)).toBeNull();
    expect(await redeemHandoffToken(database, "made-up", "shop.test", nonce)).toBeNull();

    const late = await createHandoffToken(database, grant);
    await database.update(verification).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await redeemHandoffToken(database, late ?? "", "shop.test", nonce)).toBeNull();
  });

  it("reads the binding from the session row itself", async () => {
    const { boundTenantIdOf } = await import("./handoff-access");
    expect(boundTenantIdOf({ id: "s", boundTenantId: tenantId })).toBe(tenantId);
    expect(boundTenantIdOf({ id: "s", boundTenantId: null })).toBeNull();
    expect(boundTenantIdOf({ id: "s" })).toBeNull();
    expect(boundTenantIdOf({ id: "s", boundTenantId: "" })).toBeNull();
  });

  it("signs out sessions that were bound the old (purgeable) way", async () => {
    const { revokeLegacyBoundSessions } = await import("./handoff-access");
    const { session, verification } = await import("@/server/db/schema");
    const expiresAt = new Date(Date.now() + 86_400_000);
    await database.insert(session).values([
      { id: "legacy-bound", token: "t1", userId: ownerId, expiresAt },
      { id: "plain", token: "t2", userId: ownerId, expiresAt },
    ]);
    await database.insert(verification).values({
      id: "v-legacy",
      identifier: "session-tenant:legacy-bound",
      value: "hand",
      expiresAt,
    });
    expect(await revokeLegacyBoundSessions(database)).toBe(1);
    const left = await database.select({ id: session.id }).from(session);
    expect(left.map((s) => s.id)).toEqual(["plain"]);
    expect(await revokeLegacyBoundSessions(database)).toBe(0);
  });

  it("accepts only well-formed browser hashes", () => {
    expect(cleanBrowserHash(browser)).toBe(browser);
    expect(cleanBrowserHash("short")).toBe("");
    expect(cleanBrowserHash(undefined)).toBe("");
  });
});
