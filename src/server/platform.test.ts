// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

let database: Database;
let ctx: TenantContext;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "plat"));
  // Load the modules here (60s hook timeout) so a cold import on a busy machine can't time out the first test.
  await Promise.all([
    import("@/features/clients"),
    import("@/features/projects"),
    import("@/features/settings"),
    import("@/server/export"),
    import("@/server/jobs/queue"),
  ]);
});

describe("custom domains", () => {
  it("normalises hostnames and rejects junk", async () => {
    const { normaliseHostname } = await import("@/features/settings");
    expect(normaliseHostname("https://Portal.Example.com.au/login")).toBe("portal.example.com.au");
    expect(normaliseHostname("localhost")).toBeNull();
    expect(normaliseHostname("not a domain")).toBeNull();
  });

  it("verifies through a TXT record and resolves the tenant only after that", async () => {
    const { addDomain, listDomains, tenantForHost, verifyDomain } = await import("@/features/settings");
    await addDomain(database, ctx, "portal.example.com", "app.example.com");
    await expect(addDomain(database, ctx, "portal.example.com", "app.example.com")).rejects.toThrow();
    await expect(addDomain(database, ctx, "app.example.com", "app.example.com")).rejects.toThrow();
    const [domain] = await listDomains(database, ctx.tenant.id);
    if (!domain) throw new Error("no domain");
    expect(await tenantForHost(database, "portal.example.com")).toBeNull();
    expect(await verifyDomain(database, ctx, domain.id, async () => [["wrong"]])).toBe(false);
    expect(await verifyDomain(database, ctx, domain.id, async () => [[domain.verificationToken]])).toBe(true);
    expect(await tenantForHost(database, "PORTAL.example.com")).toEqual({
      slug: "plat",
      tenantId: ctx.tenant.id,
    });
  });
});

describe("job queue", () => {
  it("dedupes, runs, retries with backoff and finally fails", async () => {
    const { enqueue, runOneJob } = await import("@/server/jobs/queue");
    const { jobs } = await import("@/server/db/schema");
    await enqueue(database, { type: "test.ok", dedupeKey: "k1" });
    await enqueue(database, { type: "test.ok", dedupeKey: "k1" });
    expect(await database.select().from(jobs).where(eq(jobs.type, "test.ok"))).toHaveLength(1);

    const ran: string[] = [];
    const handlers = new Map([
      ["test.ok", async () => void ran.push("ok")],
      ["test.fail", async () => Promise.reject(new Error("boom"))],
    ]);
    expect(await runOneJob(database, handlers)).toBe(true);
    expect(ran).toEqual(["ok"]);
    expect(await runOneJob(database, handlers)).toBe(false);

    await enqueue(database, { type: "test.fail" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runOneJob(database, handlers);
    const [failed] = await database.select().from(jobs).where(eq(jobs.type, "test.fail"));
    expect(failed?.status).toBe("pending");
    expect(failed?.attempts).toBe(1);
    expect(failed && failed.runAt.getTime() > Date.now()).toBe(true);
    expect(failed?.lastError).toContain("boom");
  });
});

describe("export", () => {
  it("exports tenant rows as safe CSV and parses CSV back", async () => {
    const { createClient } = await import("@/features/clients");
    const { exportRows, parseCsv, toCsv, toTable } = await import("@/server/export");
    const base = {
      email: "",
      phone: "",
      website: "",
      address: "",
      notes: "",
      status: "active" as const,
      custom: {},
    };
    await createClient(database, ctx, { ...base, name: '=HYPERLINK("x")', notes: 'line, with "quotes"' });
    const rows = await exportRows(database, ctx.tenant.id, "clients");
    const csv = toCsv(toTable(rows));
    expect(csv).not.toContain(",=HYPERLINK");
    const back = parseCsv(csv);
    expect(back[0]?.notes).toBe('line, with "quotes"');
    expect(back[0]?.name?.startsWith("'")).toBe(true);
  });
});

describe("project scopes", () => {
  it("shows staff only the projects they are on, and logs time only for themselves", async () => {
    const { addMember } = await import("@/server/testing/db");
    const { createProject, listProjects, logTime, listTime, setProjectMember } =
      await import("@/features/projects");
    const base = {
      description: "",
      clientId: null,
      status: "active",
      startDate: null,
      dueDate: null,
      budgetMinor: 0n,
      custom: {},
      templateId: null,
    };
    const mine = await createProject(database, ctx, { ...base, name: "Mine" });
    const other = await createProject(database, ctx, { ...base, name: "Other" });
    const { ctx: staff, membershipId } = await addMember(database, "plat", "staff", "Sam Staff");
    await setProjectMember(database, ctx, { projectId: mine, membershipId, add: true });
    expect((await listProjects(database, staff, "assigned")).map((p) => p.name)).toEqual(["Mine"]);
    await expect(
      logTime(database, staff, "own", {
        projectId: other,
        taskId: null,
        membershipId: null,
        date: "2026-07-01",
        minutes: 30,
        note: "",
        billable: true,
      }),
    ).rejects.toThrow();
    await logTime(database, staff, "own", {
      projectId: mine,
      taskId: null,
      membershipId: ctx.membership.id,
      date: "2026-07-01",
      minutes: 30,
      note: "",
      billable: true,
    });
    const entries = await listTime(database, staff, "own", { from: "2026-01-01", to: "2026-12-31" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry.membershipId).toBe(membershipId);
  });
});
