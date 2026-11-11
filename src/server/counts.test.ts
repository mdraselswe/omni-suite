// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

// Regression: counts built from a correlated sub-select compared the wrong columns and showed 0.
let database: Database;
let owner: TenantContext;

beforeAll(async () => {
  const { addMember, createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx: owner } = await setupTenant(database, "counts"));
  await addMember(database, "counts", "manager", "Mona Manager");
  await setupTenant(database, "other");
});

describe("list counts", () => {
  it("counts each business's members on the platform admin list", async () => {
    const { platformTenants } = await import("@/features/settings/service");
    const rows = await platformTenants(database);
    const members = Object.fromEntries(rows.map((r) => [r.tenant.slug, r.members]));
    expect(members).toEqual({ counts: 2, other: 1 });
  });

  it("counts a project's tasks and finished tasks", async () => {
    const { createProject, createTask, listProjects } = await import("@/features/projects/service");
    const status = owner.tenant.settings.projectStatuses[0]?.key ?? "";
    const projectId = await createProject(database, owner, {
      name: "Site",
      description: "",
      clientId: null,
      status,
      startDate: null,
      dueDate: null,
      budgetMinor: 0n,
      custom: {},
      templateId: null,
    });
    const task = {
      description: "",
      assigneeMembershipId: null,
      dueDate: null,
      clientVisible: false,
      needsApproval: false,
    };
    await createTask(database, owner, "all", projectId, { ...task, title: "One", status: "done" });
    await createTask(database, owner, "all", projectId, { ...task, title: "Two", status: "todo" });
    const [project] = await listProjects(database, owner, "all");
    expect(project).toMatchObject({ taskCount: 2, doneCount: 1 });
  });
});
