// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import { memberOverrides, memberRoles, memberships, roles } from "@/server/db/schema";
import { bumpPermissionsVersion } from "@/server/rbac/service";
import { createTestDb, createUser } from "@/server/testing/db";
import { buildTenantContext, createTenant, isValidSlug, suggestSlug } from "./service";

let database: Database;

beforeAll(async () => {
  database = await createTestDb();
});

describe("tenancy", () => {
  it("validates slugs", () => {
    expect(isValidSlug("omniscope")).toBe(true);
    expect(isValidSlug("admin")).toBe(false);
    expect(isValidSlug("A")).toBe(false);
    expect(isValidSlug("-bad")).toBe(false);
  });

  it("creates a tenant whose creator is owner with every internal permission", async () => {
    const owner = await createUser(database, "Owner One");
    const { tenantId } = await createTenant(database, {
      name: "OmniScope",
      slug: "omniscope",
      ownerUserId: owner,
    });
    const result = await buildTenantContext(database, "omniscope", owner, false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ctx.tenant.id).toBe(tenantId);
    expect(result.ctx.permissions.get("partners.manage")).toBe("all");
    expect(result.ctx.permissions.get("roles.manage")).toBe("all");
    // Owners are internal: never portal permissions.
    expect(result.ctx.permissions.has("portal.access")).toBe(false);
    expect(await suggestSlug(database, "OmniScope")).toBe("omniscope-2");
  });

  it("gives a staff member only assigned/own scopes, and overrides change it", async () => {
    const owner = await createUser(database, "Owner Two");
    const staff = await createUser(database, "Staff Two");
    const { tenantId } = await createTenant(database, { name: "Two", slug: "two-co", ownerUserId: owner });
    const [m] = await database
      .insert(memberships)
      .values({ tenantId, userId: staff, kind: "internal" })
      .returning({ id: memberships.id });
    const [staffRole] = await database.select().from(roles).where(eq(roles.key, "staff"));
    if (!m || !staffRole) throw new Error("setup");
    const [twoStaff] = await database
      .select()
      .from(roles)
      .where(eq(roles.tenantId, tenantId))
      .then((rows) => rows.filter((r) => r.key === "staff"));
    if (!twoStaff) throw new Error("setup");
    await database.insert(memberRoles).values({ membershipId: m.id, roleId: twoStaff.id });

    let ctx = await buildTenantContext(database, "two-co", staff, false);
    if (!ctx.ok) throw new Error("ctx");
    expect(ctx.ctx.permissions.get("projects.read")).toBe("assigned");
    expect(ctx.ctx.permissions.get("time.write")).toBe("own");
    expect(ctx.ctx.permissions.has("finance.read")).toBe(false);

    await database.insert(memberOverrides).values([
      { tenantId, membershipId: m.id, permission: "invoices.read", effect: "allow", scope: "all" },
      { tenantId, membershipId: m.id, permission: "time.write", effect: "deny", scope: "all" },
      // A client permission on an internal member is ignored.
      { tenantId, membershipId: m.id, permission: "portal.access", effect: "allow", scope: "all" },
    ]);
    await bumpPermissionsVersion(database, tenantId);
    ctx = await buildTenantContext(database, "two-co", staff, false);
    if (!ctx.ok) throw new Error("ctx");
    expect(ctx.ctx.permissions.get("invoices.read")).toBe("all");
    expect(ctx.ctx.permissions.has("time.write")).toBe(false);
    expect(ctx.ctx.permissions.has("portal.access")).toBe(false);
  });

  it("refuses users without a membership in that tenant", async () => {
    const stranger = await createUser(database, "Stranger");
    const result = await buildTenantContext(database, "omniscope", stranger, false);
    expect(result).toEqual({ ok: false, reason: "no-membership" });
    expect(await buildTenantContext(database, "nope", stranger, false)).toEqual({
      ok: false,
      reason: "no-tenant",
    });
  });
});
