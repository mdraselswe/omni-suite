// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import { parseClientImport } from "./import";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

let database: Database;
let ctx: TenantContext;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "cli"));
});

describe("client CSV import", () => {
  const defs = [
    { key: "industry", label: "Industry", type: "text" as const, options: [], required: true },
    { key: "seats", label: "Seats", type: "number" as const, options: [], required: false },
  ];

  it("maps cf_ columns to custom fields and reports the rows it skips", () => {
    const { clients, skippedRows } = parseClientImport(
      [
        { name: "Acme", email: "a@acme.test", cf_industry: "Retail", cf_seats: "12", extra: "x" },
        { name: "", cf_industry: "Retail" },
        { name: "No industry" },
        { name: "Bad email", email: "nope", cf_industry: "Retail" },
        { name: "Bad seats", cf_industry: "Retail", cf_seats: "lots" },
        { name: "Beta", cf_industry: "Food" },
      ],
      defs,
    );
    expect(clients.map((c) => [c.name, c.custom])).toEqual([
      ["Acme", { industry: "Retail", seats: 12 }],
      ["Beta", { industry: "Food" }],
    ]);
    expect(clients[0]?.status).toBe("active");
    expect(skippedRows).toEqual([2, 3, 4, 5]);
  });
});

describe("onboarding templates", () => {
  it("deletes unused forms only", async () => {
    const { createClient, deleteTemplate, listTemplates, saveTemplate, sendOnboarding } =
      await import("./service");
    await saveTemplate(database, ctx, { id: null, name: "Spare", fields: [], checklist: [] });
    await saveTemplate(database, ctx, { id: null, name: "Used", fields: [], checklist: [] });
    const all = await listTemplates(database, ctx.tenant.id);
    const spare = all.find((x) => x.name === "Spare");
    const used = all.find((x) => x.name === "Used");
    if (!spare || !used) throw new Error("templates missing");
    const clientId = await createClient(database, ctx, {
      name: "Acme",
      email: "",
      phone: "",
      website: "",
      address: "",
      notes: "",
      status: "active",
      custom: {},
    });
    await sendOnboarding(database, ctx, { clientId, templateId: used.id });
    await expect(deleteTemplate(database, ctx, used.id)).rejects.toThrow();
    await deleteTemplate(database, ctx, spare.id);
    const left = (await listTemplates(database, ctx.tenant.id)).map((x) => x.name);
    expect(left).toContain("Used");
    expect(left).not.toContain("Spare");
  });
});
