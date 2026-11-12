// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { limits } from "@/config";
import { headerKey, matchColumns, parseImportDate } from "@/lib/csv-import";
import type { Database } from "@/server/db";
import { parseCsv } from "@/server/export";
import type { TenantContext } from "@/server/tenancy/context";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

let database: Database;
let ctx: TenantContext;
let otherCtx: TenantContext;
let manager: { ctx: TenantContext; membershipId: string };
let staff: { ctx: TenantContext };

beforeAll(async () => {
  const { createTestDb, setupTenant, addMember } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "limp"));
  manager = await addMember(database, "limp", "manager", "Mia Manager");
  staff = await addMember(database, "limp", "staff", "Stan Staff");
  ({ ctx: otherCtx } = await setupTenant(database, "limp-other"));
});

async function plan(csv: string, c: TenantContext = ctx, format: "dmy" | "mdy" | "ymd" = "dmy") {
  const { planLeadImport } = await import("./import");
  return planLeadImport(database, c, parseCsv(csv), format);
}

async function leadsOf(tenantId: string) {
  const { leads } = await import("@/server/db/schema");
  const { eq } = await import("drizzle-orm");
  return database.select().from(leads).where(eq(leads.tenantId, tenantId));
}

describe("CSV helpers", () => {
  it("reads ISO, day-first, month-first and month-name dates", () => {
    expect(parseImportDate("2026-07-31", "dmy")).toBe("2026-07-31");
    expect(parseImportDate("2026-07-31", "mdy")).toBe("2026-07-31");
    expect(parseImportDate("03/04/2026", "dmy")).toBe("2026-04-03");
    expect(parseImportDate("03/04/2026", "mdy")).toBe("2026-03-04");
    expect(parseImportDate("3-4-26", "dmy")).toBe("2026-04-03");
    expect(parseImportDate("31.12.2026", "dmy")).toBe("2026-12-31");
    expect(parseImportDate("12 Nov 2026", "mdy")).toBe("2026-11-12");
    expect(parseImportDate("Nov 12, 2026", "dmy")).toBe("2026-11-12");
    expect(parseImportDate("2026-07-31 00:00:00", "dmy")).toBe("2026-07-31");
    expect(parseImportDate("2026-07-31T09:30:00Z", "dmy")).toBe("2026-07-31");
    expect(parseImportDate("1/7/2026 9:30 AM", "dmy")).toBe("2026-07-01");
  });

  it("refuses impossible dates and slash dates when only ISO is allowed", () => {
    expect(parseImportDate("31/02/2026", "dmy")).toBeNull();
    expect(parseImportDate("13/31/2026", "dmy")).toBeNull();
    expect(parseImportDate("03/04/2026", "ymd")).toBeNull();
    expect(parseImportDate("tomorrow", "dmy")).toBeNull();
    expect(parseImportDate("", "dmy")).toBeNull();
  });

  it("matches headers without case, spaces or punctuation, each header once", () => {
    expect(headerKey("Follow-up Date ")).toBe("followupdate");
    const cols = matchColumns(["Full Name", "E-mail", "Deal Value", "Owner"], {
      name: ["name", "full name"],
      email: ["email", "e-mail"],
      value: ["value", "deal value"],
      owner: ["owner email", "owner"],
      contact: ["full name"],
    });
    expect(cols).toEqual({ name: "Full Name", email: "E-mail", value: "Deal Value", owner: "Owner" });
  });

  it("keeps commas, quotes and line breaks inside quoted fields", () => {
    const rows = parseCsv('name,company,notes\r\n"Lee, Sam","Lee & Co, Pty","Said ""hi""\nthen left"\r\n');
    expect(rows).toEqual([{ name: "Lee, Sam", company: "Lee & Co, Pty", notes: 'Said "hi"\nthen left' }]);
  });
});

describe("lead import plan", () => {
  it("maps stages by key or label in any case; blank and unknown go to the first stage", async () => {
    const result = await plan(
      ["Name,Stage", "Ann,call", "Ben,PROPOSAL SENT", "Cat,", "Dan,Contacted", "Eve,  won  "].join("\n"),
    );
    const stages = result.rows.map((r) => r.lead?.stage);
    expect(stages).toEqual(["call", "proposal", "new", "new", "won"]);
    expect(result.rows.map((r) => r.status)).toEqual(["ready", "ready", "ready", "warning", "ready"]);
    expect(result.rows[3]?.messages.join(" ")).toMatch(/Contacted/);
  });

  it("parses values, follow-up dates, owners by email and quoted fields", async () => {
    const result = await plan(
      [
        "name,company,email,value,follow up date,owner email,notes",
        '"Lee, Sam","Lee & Co, Pty",sam@lee.test,"$2,500.50",15/12/2026,MIA.MANAGER@example.com,"Big, keen"',
        "Kim,,,1200,2026-12-01,nobody@example.com,",
      ].join("\n"),
    );
    const [first, second] = result.rows;
    expect(first?.status).toBe("ready");
    expect(first?.lead).toMatchObject({
      name: "Lee, Sam",
      company: "Lee & Co, Pty",
      email: "sam@lee.test",
      valueMinor: 250050n,
      followUpDate: "2026-12-15",
      ownerMembershipId: manager.membershipId,
      notes: "Big, keen",
    });
    expect(second?.status).toBe("warning");
    expect(second?.lead?.ownerMembershipId).toBeNull();
    expect(second?.lead?.valueMinor).toBe(120000n);
  });

  it("reports bad rows with every reason instead of dropping them", async () => {
    const result = await plan(
      ["name,email,value,follow up date", ",x@y.test,,", "Bo,not-an-email,abc,31/02/2026", "Cy,,-5,"].join(
        "\n",
      ),
    );
    expect(result.rows.map((r) => r.status)).toEqual(["error", "error", "error"]);
    expect(result.rows[1]?.messages).toHaveLength(3);
    expect(result.rows.every((r) => r.lead === null)).toBe(true);
  });

  it("refuses a file without a name column, and oversized files", async () => {
    await expect(plan("email\nx@y.test")).rejects.toThrow(/name/);
    const { readImportRows } = await import("./import");
    const big = ["name", ...Array.from({ length: limits.imports.maxRows + 1 }, (_, i) => `Lead ${i}`)];
    const form = new FormData();
    form.set("file", new File([big.join("\n")], "leads.csv", { type: "text/csv" }));
    await expect(readImportRows(form)).rejects.toThrow(String(limits.imports.maxRows));
    const empty = new FormData();
    empty.set("file", new File(["name\n"], "leads.csv"));
    await expect(readImportRows(empty)).rejects.toThrow();
  });
});

describe("importing leads", () => {
  it("imports in one go, skips duplicates (existing and within the file) and audits once", async () => {
    const { createLead } = await import("./service");
    await createLead(database, ctx, {
      name: "Old Lead",
      company: "Old Co",
      email: "old@lead.test",
      phone: "",
      source: "",
      stage: "new",
      valueMinor: 0n,
      notes: "",
      ownerMembershipId: null,
      custom: {},
    });
    const csv = [
      "name,company,email,stage",
      "Someone,Else,OLD@lead.test,new", // existing email
      "Old Lead,old co,,call", // existing name + company, no email
      "Fresh One,,fresh@lead.test,call",
      "Fresh Again,,Fresh@Lead.test,new", // same email as the row above
      "Nameless Co,Acme,,new",
      "Nameless Co, ACME ,,new", // same name + company as the row above
      "Broken,,bad-email,new",
    ].join("\n");
    const { importLeads } = await import("./import");
    const before = (await leadsOf(ctx.tenant.id)).length;
    const counts = await importLeads(database, ctx, parseCsv(csv), "dmy");
    expect(counts).toEqual({ total: 7, ready: 2, duplicates: 4, failed: 1, imported: 2 });
    const after = await leadsOf(ctx.tenant.id);
    expect(after.length).toBe(before + 2);
    expect(after.find((l) => l.email === "fresh@lead.test")?.stage).toBe("call");
    expect(after.find((l) => l.name === "Nameless Co")?.ownerMembershipId).toBe(ctx.membership.id);

    const { auditLogs } = await import("@/server/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const entries = await database
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, ctx.tenant.id), eq(auditLogs.action, "lead.import")));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.data).toMatchObject({ imported: 2, duplicates: 4, failed: 1 });

    // The same file again: everything that was imported is now a duplicate.
    const again = await importLeads(database, ctx, parseCsv(csv), "dmy");
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(6);
  });

  it("needs leads.write", async () => {
    const { importLeads } = await import("./import");
    await expect(importLeads(database, staff.ctx, parseCsv("name\nNope"), "dmy")).rejects.toThrow(
      /leads.write/,
    );
    const counts = await importLeads(database, manager.ctx, parseCsv("name\nManaged Lead"), "dmy");
    expect(counts.imported).toBe(1);
    const mine = (await leadsOf(ctx.tenant.id)).find((l) => l.name === "Managed Lead");
    expect(mine?.ownerMembershipId).toBe(manager.membershipId);
  });

  it("keeps tenants apart: other businesses' leads are not duplicates and get nothing", async () => {
    const { importLeads } = await import("./import");
    const otherBefore = (await leadsOf(otherCtx.tenant.id)).length;
    // fresh@lead.test exists in the first business only.
    const result = await plan("name,email\nFresh One,fresh@lead.test", otherCtx);
    expect(result.rows[0]?.status).toBe("ready");
    // An owner email from the first business doesn't make someone an owner here.
    const owner = await plan("name,owner\nX,mia.manager@example.com", otherCtx);
    expect(owner.rows[0]?.status).toBe("warning");
    await importLeads(database, otherCtx, parseCsv("name,email\nFresh One,fresh@lead.test"), "dmy");
    expect((await leadsOf(otherCtx.tenant.id)).length).toBe(otherBefore + 1);
    const firstTenant = await leadsOf(ctx.tenant.id);
    expect(firstTenant.filter((l) => l.email === "fresh@lead.test")).toHaveLength(1);
  });
});
