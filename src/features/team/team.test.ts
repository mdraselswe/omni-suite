// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

let database: Database;
let owner: TenantContext;
let ownerMembership: string;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx: owner } = await setupTenant(database, "team"));
  ownerMembership = owner.membership.id;
});

describe("team and roles", () => {
  it("keeps at least one owner", async () => {
    const { listRoles, setMemberRoles, updateMember } = await import("./service");
    const manager = (await listRoles(database, owner.tenant.id)).find((r) => r.key === "manager");
    await expect(setMemberRoles(database, owner, ownerMembership, [manager?.id ?? ""])).rejects.toThrow();
    await expect(
      updateMember(database, owner, ownerMembership, { title: "", status: "disabled" }),
    ).rejects.toThrow();
  });

  it("stops a manager from granting powers they don't hold", async () => {
    const { addMember } = await import("@/server/testing/db");
    const { addOverride, createInvitation, listRoles } = await import("./service");
    const { ctx: manager, membershipId } = await addMember(database, "team", "manager", "Mona Manager");
    const roles = await listRoles(database, owner.tenant.id);
    const ownerRole = roles.find((r) => r.key === "owner")?.id ?? "";
    // Managers can't invite at all (no members.invite), and never as owner.
    await expect(
      createInvitation(database, manager, {
        email: "x@example.com",
        kind: "internal",
        clientId: null,
        roleIds: [ownerRole],
      }),
    ).rejects.toThrow();
    await expect(
      addOverride(database, manager, {
        membershipId,
        permission: "finance.write",
        effect: "allow",
        scope: "all",
        expiresAt: null,
        reason: "",
      }),
    ).rejects.toThrow();
  });

  it("lets the owner edit a role and resets it to default", async () => {
    const { listRoles, resetRole, updateRole, deleteRole, createRole } = await import("./service");
    const staff = (await listRoles(database, owner.tenant.id)).find((r) => r.key === "staff");
    if (!staff) throw new Error("no staff role");
    await updateRole(database, owner, staff.id, {
      name: "Staff",
      description: "",
      grants: [{ permission: "projects.read", scope: "all" }],
    });
    expect((await listRoles(database, owner.tenant.id)).find((r) => r.id === staff.id)?.grants).toEqual([
      { permission: "projects.read", scope: "all" },
    ]);
    await resetRole(database, owner, staff.id);
    expect(
      (await listRoles(database, owner.tenant.id)).find((r) => r.id === staff.id)?.grants.length,
    ).toBeGreaterThan(1);
    await expect(deleteRole(database, owner, staff.id)).rejects.toThrow(); // default roles can't be deleted

    const custom = await createRole(database, owner, {
      name: "Designer",
      description: "",
      audience: "internal",
      copyFromRoleId: staff.id,
    });
    expect(
      (await listRoles(database, owner.tenant.id)).find((r) => r.id === custom)?.grants.length,
    ).toBeGreaterThan(0);
    await deleteRole(database, owner, custom);
  });

  it("accepts an invitation only for the invited email, once", async () => {
    const { createUser } = await import("@/server/testing/db");
    const { acceptInvitation, createInvitation, listRoles } = await import("./service");
    const staff = (await listRoles(database, owner.tenant.id)).find((r) => r.key === "staff");
    const { token } = await createInvitation(database, owner, {
      email: "new@example.com",
      kind: "internal",
      clientId: null,
      roleIds: [staff?.id ?? ""],
    });
    const otherId = await createUser(database, "Other", "other@example.com");
    await expect(acceptInvitation(database, token, { id: otherId })).rejects.toThrow();
    const newId = await createUser(database, "New", "new@example.com");
    expect(await acceptInvitation(database, token, { id: newId })).toEqual({
      slug: "team",
      kind: "internal",
    });
    await expect(acceptInvitation(database, token, { id: newId })).rejects.toThrow();
  });
});

describe("tenant and client isolation", () => {
  it("never shows one client's invoices, files or projects to another client or tenant", async () => {
    const { addMember, setupTenant } = await import("@/server/testing/db");
    const { createClient } = await import("@/features/clients");
    const { createInvoice, sendInvoice, listInvoices, getInvoice } = await import("@/features/invoices");
    const { createProject, listProjects } = await import("@/features/projects");
    const base = {
      email: "",
      phone: "",
      website: "",
      address: "",
      notes: "",
      status: "active" as const,
      custom: {},
    };
    const a = await createClient(database, owner, { ...base, name: "Client A" });
    const b = await createClient(database, owner, { ...base, name: "Client B" });
    const item = { description: "Work", quantity: "1", unitPriceMinor: "10000", taxRateBp: 1000 };
    const invA = await createInvoice(database, owner, {
      clientId: a,
      issueDate: "2026-07-01",
      dueDate: "2026-07-14",
      items: [item],
      notes: "",
      custom: {},
    });
    const invB = await createInvoice(database, owner, {
      clientId: b,
      issueDate: "2026-07-01",
      dueDate: "2026-07-14",
      items: [item],
      notes: "",
      custom: {},
    });
    await sendInvoice(database, owner, invA);
    await sendInvoice(database, owner, invB);
    await createProject(database, owner, {
      name: "A site",
      description: "",
      clientId: a,
      status: "active",
      startDate: null,
      dueDate: null,
      budgetMinor: 0n,
      custom: {},
      templateId: null,
    });
    await createProject(database, owner, {
      name: "B site",
      description: "",
      clientId: b,
      status: "active",
      startDate: null,
      dueDate: null,
      budgetMinor: 0n,
      custom: {},
      templateId: null,
    });

    const { ctx: clientA } = await addMember(database, "team", "client_owner", "Client User", {
      kind: "client",
      clientId: a,
    });
    const portal = await listInvoices(database, clientA.tenant.id, {
      clientId: clientA.membership.clientId ?? "",
      portal: true,
    });
    expect(portal.map((r) => r.invoice.id)).toEqual([invA]);
    const projects = await listProjects(database, clientA, "all");
    expect(projects.map((p) => p.name)).toEqual(["A site"]);

    const { ctx: other } = await setupTenant(database, "other");
    expect(await getInvoice(database, other.tenant.id, invA)).toBeNull();
    expect(await listInvoices(database, other.tenant.id)).toHaveLength(0);
  });
});
