// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

// Seat limits come from billing; here we control them directly.
const seats = vi.hoisted(() => ({
  assert: vi.fn<(database: unknown, tenant: unknown) => Promise<void>>(async () => {}),
}));
vi.mock("@/features/billing", () => ({ assertSeatAvailable: seats.assert }));

let database: Database;
let owner: TenantContext;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx: owner } = await setupTenant(database, "crew"));
});

async function contextOf(userId: string): Promise<TenantContext> {
  const { buildTenantContext } = await import("@/server/tenancy/service");
  const result = await buildTenantContext(database, "crew", userId, false);
  if (!result.ok) throw new Error("context failed");
  return result.ctx;
}

describe("switching members off and on", () => {
  it("doesn't let an admin switch off an owner, or anyone switch off someone more powerful", async () => {
    const { addMember } = await import("@/server/testing/db");
    const { addOverride, updateMember } = await import("./service");
    const admin = await addMember(database, "crew", "admin", "Ada Admin");
    const staff = await addMember(database, "crew", "staff", "Stu Staff");
    const manager = await addMember(database, "crew", "manager", "Max Manager");

    await expect(
      updateMember(database, admin.ctx, owner.membership.id, { title: "", status: "disabled" }),
    ).rejects.toThrow(/owner/i);

    // A manager who was given members.manage still can't switch off an admin (settings, invites…).
    await addOverride(database, owner, {
      membershipId: manager.membershipId,
      permission: "members.manage",
      effect: "allow",
      scope: "all",
      expiresAt: null,
      reason: "",
    });
    const managerCtx = await contextOf(manager.userId);
    await expect(
      updateMember(database, managerCtx, admin.membershipId, { title: "", status: "disabled" }),
    ).rejects.toThrow();

    // The admin holds everything staff can do, so this is fine.
    await updateMember(database, admin.ctx, staff.membershipId, { title: "Designer", status: "disabled" });
    const { memberships } = await import("@/server/db/schema");
    const [row] = await database.select().from(memberships).where(eq(memberships.id, staff.membershipId));
    expect(row?.status).toBe("disabled");
  });

  it("checks the plan's seat limit when a team member is switched back on", async () => {
    const { addMember } = await import("@/server/testing/db");
    const { UserError } = await import("@/server/action");
    const { updateMember } = await import("./service");
    const member = await addMember(database, "crew", "staff", "Sue Seat");
    await updateMember(database, owner, member.membershipId, { title: "", status: "disabled" });

    seats.assert.mockClear();
    await updateMember(database, owner, member.membershipId, { title: "New title", status: "disabled" });
    expect(seats.assert).not.toHaveBeenCalled(); // title-only change takes no seat

    seats.assert.mockRejectedValueOnce(new UserError("plan full"));
    await expect(
      updateMember(database, owner, member.membershipId, { title: "", status: "active" }),
    ).rejects.toThrow("plan full");

    await updateMember(database, owner, member.membershipId, { title: "", status: "active" });
    expect(seats.assert).toHaveBeenCalledTimes(2);
  });
});

describe("resetting a role", () => {
  it("runs the escalation guard on the permissions a reset would add", async () => {
    const { addMember } = await import("@/server/testing/db");
    const { addOverride, listRoles, resetRole, updateRole } = await import("./service");
    const accountant = (await listRoles(database, owner.tenant.id)).find((r) => r.key === "accountant");
    if (!accountant) throw new Error("no accountant role");
    await updateRole(database, owner, accountant.id, {
      name: accountant.name,
      description: accountant.description,
      grants: [{ permission: "dashboard.read", scope: "all" }],
    });

    const manager = await addMember(database, "crew", "manager", "Mia Manager");
    await addOverride(database, owner, {
      membershipId: manager.membershipId,
      permission: "roles.manage",
      effect: "allow",
      scope: "all",
      expiresAt: null,
      reason: "",
    });
    // Resetting would hand the accountant role finance access the manager doesn't have.
    await expect(resetRole(database, await contextOf(manager.userId), accountant.id)).rejects.toThrow();

    await resetRole(database, owner, accountant.id);
    const after = (await listRoles(database, owner.tenant.id)).find((r) => r.id === accountant.id);
    expect(after?.grants.some((g) => g.permission === "finance.read")).toBe(true);
  });
});

describe("invitations", () => {
  it("can only be accepted with a verified email address", async () => {
    const { user } = await import("@/server/db/schema");
    const { uuidv7 } = await import("@/lib/ids");
    const { acceptInvitation, createInvitation, listRoles } = await import("./service");
    const staff = (await listRoles(database, owner.tenant.id)).find((r) => r.key === "staff");
    const { token } = await createInvitation(database, owner, {
      email: "invitee@example.com",
      kind: "internal",
      clientId: null,
      roleIds: [staff?.id ?? ""],
    });
    // Someone signed up with the invitee's address but never proved they own it.
    const squatter = uuidv7();
    await database
      .insert(user)
      .values({ id: squatter, name: "Squatter", email: "invitee@example.com", emailVerified: false });
    await expect(acceptInvitation(database, token, { id: squatter })).rejects.toThrow(/confirm/i);

    await database.update(user).set({ emailVerified: true }).where(eq(user.id, squatter));
    expect(await acceptInvitation(database, token, { id: squatter })).toEqual({
      slug: "crew",
      kind: "internal",
    });
  });
});
