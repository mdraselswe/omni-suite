// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

let database: Database;
let owner: TenantContext;
let ownerMembership: string;
let admin: TenantContext;
let adminMembership: string;
let staffMembership: string;

const override = (
  membershipId: string,
  permission: string,
  effect: "allow" | "deny",
  scope: "own" | "assigned" | "all" = "all",
) => ({ membershipId, permission, effect, scope, expiresAt: null, reason: "" });

beforeAll(async () => {
  const { createTestDb, setupTenant, addMember } = await import("@/server/testing/db");
  const { memberships } = await import("@/server/db/schema");
  const { eq } = await import("drizzle-orm");
  database = await createTestDb();
  const setup = await setupTenant(database, "ovr");
  owner = setup.ctx;
  const [m] = await database.select().from(memberships).where(eq(memberships.userId, setup.ownerId));
  if (!m) throw new Error("no owner membership");
  ownerMembership = m.id;
  ({ ctx: admin, membershipId: adminMembership } = await addMember(database, "ovr", "admin", "Ada Admin"));
  ({ membershipId: staffMembership } = await addMember(database, "ovr", "staff", "Sam Staff"));
});

describe("permission overrides", () => {
  it("can't be changed on yourself, even to allow something", async () => {
    const { addOverride } = await import("./service");
    await expect(
      addOverride(database, admin, override(adminMembership, "files.write", "allow")),
    ).rejects.toThrow(/your own/);
  });

  it("only an owner may change an owner's overrides", async () => {
    const { addOverride } = await import("./service");
    await expect(
      addOverride(database, admin, override(ownerMembership, "files.write", "deny")),
    ).rejects.toThrow(/Only an owner/);
  });

  it("needs the actor to hold what they grant, and what they deny", async () => {
    const { addOverride } = await import("./service");
    // The admin doesn't hold backup.manage: can't hand it out, nor take it away.
    await expect(
      addOverride(database, admin, override(staffMembership, "backup.manage", "allow")),
    ).rejects.toThrow();
    await expect(
      addOverride(database, admin, override(staffMembership, "backup.manage", "deny")),
    ).rejects.toThrow();
    // Within the admin's powers: fine.
    await expect(
      addOverride(database, admin, override(staffMembership, "files.write", "deny", "own")),
    ).resolves.toBeUndefined();
  });

  it("guards removals the same way", async () => {
    const { addOverride, memberOverridesList, removeOverride } = await import("./service");
    // The owner gives staff backup.manage; the admin (who lacks it) can't take it back.
    await addOverride(database, owner, override(staffMembership, "backup.manage", "allow"));
    const granted = (await memberOverridesList(database, owner.tenant.id, staffMembership)).find(
      (o) => o.permission === "backup.manage",
    );
    if (!granted) throw new Error("override missing");
    await expect(removeOverride(database, admin, granted.id)).rejects.toThrow();

    // The owner denies the admin something; the admin can't lift a deny on themselves.
    await addOverride(database, owner, override(adminMembership, "files.write", "deny"));
    const denied = (await memberOverridesList(database, owner.tenant.id, adminMembership))[0];
    if (!denied) throw new Error("override missing");
    await expect(removeOverride(database, admin, denied.id)).rejects.toThrow(/your own/);

    await removeOverride(database, owner, granted.id);
    await removeOverride(database, owner, denied.id);
    expect(await memberOverridesList(database, owner.tenant.id, adminMembership)).toHaveLength(0);
  });
});
