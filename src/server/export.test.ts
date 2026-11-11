// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

let database: Database;
let owner: TenantContext;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx: owner } = await setupTenant(database, "exp"));
  await import("@/server/export");
});

describe("export permissions", () => {
  it("guards every set with a real catalog permission", async () => {
    const { EXPORT_PERMISSIONS, EXPORT_SET_NAMES } = await import("@/server/export");
    const { permissionDef } = await import("@/modules/catalog");
    for (const set of EXPORT_SET_NAMES) {
      expect(permissionDef(EXPORT_PERMISSIONS[set]), set).toBeDefined();
    }
    expect(EXPORT_PERMISSIONS.leads).toBe("leads.read");
    expect(EXPORT_PERMISSIONS.audit_log).toBe("audit.read");
    expect(EXPORT_PERMISSIONS.transactions).toBe("finance.export");
  });

  it("lets each role download only the sets it may see in full", async () => {
    const { addMember } = await import("@/server/testing/db");
    const { canExportSet, exportableSets, EXPORT_SET_NAMES } = await import("@/server/export");
    expect(exportableSets(owner)).toEqual(EXPORT_SET_NAMES);

    const { ctx: manager } = await addMember(database, "exp", "manager", "Mia Manager");
    expect(canExportSet(manager, "leads")).toBe(true);
    expect(canExportSet(manager, "transactions")).toBe(false);
    expect(canExportSet(manager, "audit_log")).toBe(false);
    expect(canExportSet(manager, "partners")).toBe(false);

    const { ctx: accountant } = await addMember(database, "exp", "accountant", "Ari Accountant");
    expect(canExportSet(accountant, "transactions")).toBe(true);
    expect(canExportSet(accountant, "audit_log")).toBe(true);
    expect(canExportSet(accountant, "leads")).toBe(false);
    expect(canExportSet(accountant, "onboarding")).toBe(false);

    // Staff only see assigned projects: no full project or task export.
    const { ctx: staff } = await addMember(database, "exp", "staff", "Sam Staff");
    expect(canExportSet(staff, "projects")).toBe(false);
    expect(canExportSet(staff, "tasks")).toBe(false);
    expect(exportableSets(staff)).toEqual([]);
  });
});
