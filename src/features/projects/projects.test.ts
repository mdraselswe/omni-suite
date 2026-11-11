// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/dates";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import { hoursQuantity, timeInvoiceLines } from "./time-invoice";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

let database: Database;
let ctx: TenantContext;
let staff: { ctx: TenantContext; membershipId: string; userId: string };
let manager: { ctx: TenantContext; membershipId: string; userId: string };
let portal: TenantContext;
let outsider: { membershipId: string };
let clientId: string;
let otherClientId: string;
let project: string;
let offProject: string;

const base = {
  description: "",
  status: "active",
  startDate: null,
  dueDate: null,
  budgetMinor: 0n,
  custom: {},
  templateId: null,
};
const entry = { taskId: null, membershipId: null, date: "2026-07-01", note: "", billable: true };
const task = {
  title: "Homepage",
  description: "",
  status: "todo" as const,
  assigneeMembershipId: null,
  dueDate: null,
  clientVisible: true,
  needsApproval: true,
};

beforeAll(async () => {
  const { createTestDb, setupTenant, addMember } = await import("@/server/testing/db");
  const { createClient } = await import("@/features/clients");
  const { createProject, setProjectMember } = await import("./service");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "prj"));
  await setupTenant(database, "prj-other");
  outsider = await addMember(database, "prj-other", "staff", "Olly Outsider");
  const client = (name: string) =>
    createClient(database, ctx, {
      name,
      email: "",
      phone: "",
      website: "",
      address: "",
      notes: "",
      status: "active",
      custom: {},
    });
  clientId = await client("Acme");
  otherClientId = await client("Other Co");
  project = await createProject(database, ctx, { ...base, name: "Acme site", clientId });
  offProject = await createProject(database, ctx, { ...base, name: "Internal", clientId: null });
  staff = await addMember(database, "prj", "staff", "Sam Staff");
  manager = await addMember(database, "prj", "manager", "Mia Manager");
  await setProjectMember(database, ctx, { projectId: project, membershipId: staff.membershipId, add: true });
  ({ ctx: portal } = await addMember(database, "prj", "client_owner", "Cara Client", {
    kind: "client",
    clientId,
  }));
});

describe("time invoice lines", () => {
  it("turns minutes into hours with up to 3 decimals", () => {
    expect(hoursQuantity(90)).toBe("1.5");
    expect(hoursQuantity(60)).toBe("1");
    expect(hoursQuantity(20)).toBe("0.333");
    expect(hoursQuantity(0)).toBe("0");
  });

  it("groups by person and rate", () => {
    const lines = timeInvoiceLines(
      [
        { membershipId: "a", minutes: 60, hourlyRateMinor: 100_00n },
        { membershipId: "b", minutes: 30, hourlyRateMinor: 80_00n },
        { membershipId: "a", minutes: 30, hourlyRateMinor: 100_00n },
        { membershipId: "a", minutes: 60, hourlyRateMinor: 120_00n },
      ],
      { taxRateBp: 1000, describe: (id) => `Person ${id}` },
    );
    expect(lines).toEqual([
      { description: "Person a", quantity: "1.5", unitPriceMinor: "10000", taxRateBp: 1000 },
      { description: "Person b", quantity: "0.5", unitPriceMinor: "8000", taxRateBp: 1000 },
      { description: "Person a", quantity: "1", unitPriceMinor: "12000", taxRateBp: 1000 },
    ]);
  });
});

describe("ids from forms", () => {
  it("rejects clients, members and tasks from outside the business or project", async () => {
    const { createTask, logTime, updateProject, updateTask } = await import("./service");
    const { createClient } = await import("@/features/clients");
    const { setupTenant } = await import("@/server/testing/db");
    const { ctx: foreign } = await setupTenant(database, "prj-third");
    const foreignClient = await createClient(database, foreign, {
      name: "Foreign",
      email: "",
      phone: "",
      website: "",
      address: "",
      notes: "",
      status: "active",
      custom: {},
    });
    await expect(
      updateProject(database, ctx, "all", project, { ...base, name: "Acme site", clientId: foreignClient }),
    ).rejects.toThrow();
    await expect(
      createTask(database, ctx, "all", project, { ...task, assigneeMembershipId: outsider.membershipId }),
    ).rejects.toThrow();
    const taskId = await createTask(database, ctx, "all", project, {
      ...task,
      title: "Valid",
      assigneeMembershipId: staff.membershipId,
    });
    await expect(
      updateTask(database, ctx, "all", taskId, { assigneeMembershipId: outsider.membershipId }),
    ).rejects.toThrow();
    await expect(
      logTime(database, ctx, "all", {
        ...entry,
        projectId: project,
        minutes: 30,
        membershipId: outsider.membershipId,
      }),
    ).rejects.toThrow();
    const otherTask = await createTask(database, ctx, "all", offProject, { ...task, title: "Elsewhere" });
    await expect(
      logTime(database, ctx, "all", { ...entry, projectId: project, minutes: 30, taskId: otherTask }),
    ).rejects.toThrow();
  });

  it("keeps staff comments to projects in their read scope", async () => {
    const { addComment, listComments } = await import("./service");
    expect(staff.ctx.permissions.get("projects.read")).toBe("assigned");
    await expect(
      addComment(database, staff.ctx, { projectId: offProject, body: "Hi", clientVisible: false }),
    ).rejects.toThrow();
    await addComment(database, staff.ctx, { projectId: project, body: "On it", clientVisible: false });
    const list = await listComments(database, ctx, "project", project);
    expect(list.some((c) => c.comment.body === "On it")).toBe(true);
  });
});

describe("billing time", () => {
  it("invoices unbilled billable time once, one line per person and rate", async () => {
    const { invoices, timeEntries } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const { deleteTime, invoiceUnbilledTime, listTime, logTime, setRate, unbilledTime } =
      await import("./service");
    await setRate(database, ctx, {
      membershipId: staff.membershipId,
      costRateMinor: 40_00n,
      billRateMinor: 100_00n,
    });
    await setRate(database, ctx, {
      membershipId: manager.membershipId,
      costRateMinor: 60_00n,
      billRateMinor: 150_00n,
    });
    await logTime(database, ctx, "all", {
      ...entry,
      projectId: project,
      minutes: 90,
      membershipId: staff.membershipId,
    });
    await logTime(database, ctx, "all", {
      ...entry,
      projectId: project,
      minutes: 30,
      membershipId: staff.membershipId,
    });
    await logTime(database, ctx, "all", {
      ...entry,
      projectId: project,
      minutes: 60,
      membershipId: manager.membershipId,
    });
    await logTime(database, ctx, "all", {
      ...entry,
      projectId: project,
      minutes: 45,
      membershipId: manager.membershipId,
      billable: false,
    });

    const before = await unbilledTime(database, ctx.tenant.id, project);
    expect(before).toEqual({ count: 3, minutes: 180, valueMinor: 350_00n });

    const invoiceId = await invoiceUnbilledTime(database, ctx, "all", project, "2026-07-31");
    const [invoice] = await database.select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(invoice?.status).toBe("draft");
    expect(invoice?.clientId).toBe(clientId);
    expect(invoice?.dueDate).toBe(addDays("2026-07-31", ctx.tenant.settings.paymentTermsDays));
    expect(invoice?.items.map((i) => [i.quantity, i.unitPriceMinor])).toEqual([
      ["2", "10000"],
      ["1", "15000"],
    ]);
    expect(invoice?.subtotalMinor).toBe(350_00n);
    expect(invoice?.items.every((i) => i.taxRateBp === ctx.tenant.settings.tax.rateBp)).toBe(true);

    const rows = await database.select().from(timeEntries).where(eq(timeEntries.projectId, project));
    expect(rows.filter((r) => r.invoiceId === invoiceId)).toHaveLength(3);
    expect(rows.find((r) => !r.billable)?.invoiceId).toBeNull();
    expect((await unbilledTime(database, ctx.tenant.id, project)).count).toBe(0);
    await expect(invoiceUnbilledTime(database, ctx, "all", project, "2026-07-31")).rejects.toThrow();

    // Billed time can't be deleted; the list shows which entries are billed.
    const billed = rows.find((r) => r.invoiceId === invoiceId);
    if (!billed) throw new Error("no billed entry");
    await expect(deleteTime(database, ctx, "all", billed.id)).rejects.toThrow();
    const listed = await listTime(database, ctx, "all", {
      from: "2026-01-01",
      to: "2026-12-31",
      projectId: project,
    });
    expect(listed.filter((r) => r.entry.invoiceId === invoiceId)).toHaveLength(3);
  });

  it("refuses projects without a client or outside the member's scope", async () => {
    const { invoiceUnbilledTime, logTime } = await import("./service");
    await logTime(database, ctx, "all", { ...entry, projectId: offProject, minutes: 60 });
    await expect(invoiceUnbilledTime(database, ctx, "all", offProject, "2026-07-31")).rejects.toThrow();
    await logTime(database, ctx, "all", { ...entry, projectId: project, minutes: 60 });
    await expect(invoiceUnbilledTime(database, manager.ctx, "own", project, "2026-07-31")).rejects.toThrow();
  });
});

describe("client review", () => {
  it("lets the client send a task under review back with a note, telling the assignee", async () => {
    const { comments, notifications, tasks } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const { createTask, requestTaskChanges, updateTask } = await import("./service");
    const id = await createTask(database, ctx, "all", project, {
      ...task,
      title: "Logo",
      assigneeMembershipId: staff.membershipId,
    });
    await expect(requestTaskChanges(database, portal, id, "Bigger please")).rejects.toThrow();
    await updateTask(database, ctx, "all", id, { status: "review" });
    await expect(requestTaskChanges(database, portal, id, "   ")).rejects.toThrow();
    await expect(requestTaskChanges(database, ctx, id, "Staff can't")).rejects.toThrow();

    await requestTaskChanges(database, portal, id, "Bigger please");
    const [row] = await database.select().from(tasks).where(eq(tasks.id, id));
    expect(row?.status).toBe("in_progress");
    expect(row?.approvedAt).toBeNull();
    const notes = await database.select().from(comments).where(eq(comments.entityId, project));
    expect(notes.some((c) => c.body.includes("Bigger please") && c.clientVisible)).toBe(true);
    const inbox = await database.select().from(notifications).where(eq(notifications.userId, staff.userId));
    expect(inbox.some((n) => n.title.includes("Logo") && n.body === "Bigger please")).toBe(true);
  });

  it("does not let a client review another client's task", async () => {
    const { addMember } = await import("@/server/testing/db");
    const { createTask, requestTaskChanges, updateTask } = await import("./service");
    const { ctx: stranger } = await addMember(database, "prj", "client_owner", "Stan Stranger", {
      kind: "client",
      clientId: otherClientId,
    });
    const id = await createTask(database, ctx, "all", project, { ...task, title: "Footer" });
    await updateTask(database, ctx, "all", id, { status: "review" });
    await expect(requestTaskChanges(database, stranger, id, "No")).rejects.toThrow();
  });
});

describe("templates and rates", () => {
  it("audits template saves, deletes templates and audits rate changes", async () => {
    const { auditLogs, projectTemplates } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const { deleteProjectTemplate, saveProjectTemplate, setRate } = await import("./service");
    const id = await saveProjectTemplate(database, ctx, {
      id: null,
      name: "Website",
      tasks: [{ title: "Kickoff", clientVisible: false }],
    });
    await saveProjectTemplate(database, ctx, { id, name: "Website v2", tasks: [] });
    await deleteProjectTemplate(database, ctx, id);
    expect(await database.select().from(projectTemplates).where(eq(projectTemplates.id, id))).toHaveLength(0);
    await expect(deleteProjectTemplate(database, ctx, id)).rejects.toThrow();
    await expect(
      setRate(database, ctx, { membershipId: outsider.membershipId, costRateMinor: 1n, billRateMinor: 1n }),
    ).rejects.toThrow();
    const actions = (await database.select({ action: auditLogs.action }).from(auditLogs)).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(["projectTemplate.save", "projectTemplate.delete", "member.rate"]),
    );
  });
});
