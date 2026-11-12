// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";

let database: Database;

beforeAll(async () => {
  const { createTestDb } = await import("@/server/testing/db");
  database = await createTestDb();
});

describe("full backups", () => {
  it("need an owner, or backup.manage plus every data set", async () => {
    const { addMember, setupTenant } = await import("@/server/testing/db");
    const { addOverride } = await import("@/features/team");
    const { buildTenantContext } = await import("@/server/tenancy/service");
    const { canBackUpEverything } = await import("./service");
    const { ctx: owner } = await setupTenant(database, "bkp");
    const { userId, membershipId } = await addMember(database, "bkp", "manager", "Max Manager");
    await addOverride(database, owner, {
      membershipId,
      permission: "backup.manage",
      effect: "allow",
      scope: "all",
      expiresAt: null,
      reason: "",
    });
    const manager = await buildTenantContext(database, "bkp", userId, false);
    if (!manager.ok) throw new Error("context failed");
    expect(manager.ctx.permissions.get("backup.manage")).toBe("all");

    expect(await canBackUpEverything(database, owner)).toBe(true);
    // backup.manage alone would expose the ledger the manager can't read.
    expect(await canBackUpEverything(database, manager.ctx)).toBe(false);
  });
});
