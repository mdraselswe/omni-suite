// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import { parsePage } from "@/lib/pagination";
import type { Scope } from "@/server/rbac/resolve";
import { carryCustomValues } from "./carry-custom";
import type { LeadFilter, LeadInput } from "./service";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

let database: Database;
let ctx: TenantContext;
let manager: { ctx: TenantContext; membershipId: string };

const lead = (over: Partial<LeadInput> = {}): LeadInput => ({
  name: "Jo Lead",
  company: "",
  email: "",
  phone: "",
  source: "",
  stage: "new",
  valueMinor: 0n,
  notes: "",
  ownerMembershipId: null,
  custom: {},
  ...over,
});

/** Lead ids on the first page of 100 that match a filter. */
async function leadIds(c: TenantContext, scope: Scope, filter: LeadFilter = {}) {
  const { pageLeads } = await import("./service");
  const page = await pageLeads(database, c, scope, filter, parsePage({ size: "100" }));
  return page.rows.map((r) => r.lead.id);
}

beforeAll(async () => {
  const { createTestDb, setupTenant, addMember } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "crm"));
  manager = await addMember(database, "crm", "manager", "Mia Manager");
  await setupTenant(database, "crm-other");
});

describe("carryCustomValues", () => {
  const defs = [
    { key: "budget", label: "Budget", type: "number" as const, options: [], required: true },
    { key: "tier", label: "Tier", type: "select" as const, options: ["Silver", "Gold"], required: false },
    { key: "vip", label: "VIP", type: "checkbox" as const, options: [], required: false },
    { key: "start", label: "Start", type: "date" as const, options: [], required: false },
  ];

  it("keeps only keys the target has and values that pass its checks", () => {
    expect(
      carryCustomValues(defs, { budget: 5000, tier: "Bronze", vip: true, start: "nope", leadOnly: "x" }),
    ).toEqual({ budget: 5000, vip: true });
    expect(carryCustomValues(defs, { tier: "Gold", start: "2026-07-01" })).toEqual({
      tier: "Gold",
      start: "2026-07-01",
    });
    expect(carryCustomValues(defs, null)).toEqual({});
  });
});

describe("leads", () => {
  it("converts a lead into a client once, carrying matching custom fields", async () => {
    const { customFieldDefs, clients, leads } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const { createLead, convertLead } = await import("./service");
    await database.insert(customFieldDefs).values([
      { tenantId: ctx.tenant.id, entity: "client", key: "industry", label: "Industry", type: "text" },
      {
        tenantId: ctx.tenant.id,
        entity: "client",
        key: "size",
        label: "Size",
        type: "select",
        options: ["Small", "Large"],
      },
    ]);
    const id = await createLead(
      database,
      ctx,
      lead({ company: "Acme", custom: { industry: "Retail", size: "Huge", score: 7 } }),
    );
    const clientId = await convertLead(database, ctx, "all", id);
    const [client] = await database.select().from(clients).where(eq(clients.id, clientId));
    expect(client?.name).toBe("Acme");
    expect(client?.custom).toEqual({ industry: "Retail" });
    const [row] = await database.select().from(leads).where(eq(leads.id, id));
    expect(row?.clientId).toBe(clientId);
    expect(row?.stage).toBe("won");
    // Converting again returns the same client instead of creating a second one.
    expect(await convertLead(database, ctx, "all", id)).toBe(clientId);
  });

  it("rejects owners that are not active team members of this business", async () => {
    const { addMember } = await import("@/server/testing/db");
    const { createClient } = await import("@/features/clients");
    const { createLead, updateLead } = await import("./service");
    const other = await addMember(database, "crm-other", "manager", "Outsider");
    await expect(
      createLead(database, ctx, lead({ ownerMembershipId: other.membershipId })),
    ).rejects.toThrow();
    const clientId = await createClient(database, ctx, {
      name: "Portal Co",
      email: "",
      phone: "",
      website: "",
      address: "",
      notes: "",
      status: "active",
      custom: {},
    });
    const portal = await addMember(database, "crm", "client_owner", "Pat Portal", {
      kind: "client",
      clientId,
    });
    await expect(
      createLead(database, ctx, lead({ ownerMembershipId: portal.membershipId })),
    ).rejects.toThrow();
    const id = await createLead(database, ctx, lead({ ownerMembershipId: manager.membershipId }));
    await expect(
      updateLead(database, ctx, "all", id, lead({ ownerMembershipId: other.membershipId })),
    ).rejects.toThrow();
  });

  it("limits own-scope members to their own leads", async () => {
    const { createLead, moveLead, setLeadArchived } = await import("./service");
    const ownersLead = await createLead(database, ctx, lead({ name: "Owner's lead" }));
    const mine = await createLead(database, manager.ctx, lead({ name: "Mia's lead" }));
    const visible = await leadIds(manager.ctx, "own");
    expect(visible).toContain(mine);
    expect(visible).not.toContain(ownersLead);
    await expect(moveLead(database, manager.ctx, "own", ownersLead, "call")).rejects.toThrow();
    await expect(setLeadArchived(database, manager.ctx, "own", ownersLead, true)).rejects.toThrow();
    await moveLead(database, manager.ctx, "own", mine, "call");
  });

  it("archives leads out of the board and totals, and restores them", async () => {
    const { auditLogs } = await import("@/server/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const { archivedLeadCount, createLead, leadStageTotals, pipelineSummary, setLeadArchived } =
      await import("./service");
    const id = await createLead(
      database,
      ctx,
      lead({ name: "Spam Sender", stage: "proposal", valueMinor: 99_00n }),
    );
    const before = await pipelineSummary(database, ctx);
    const totalsBefore = await leadStageTotals(database, ctx, "all");

    await setLeadArchived(database, ctx, "all", id, true);
    expect(await leadIds(ctx, "all")).not.toContain(id);
    expect(await leadIds(ctx, "all", { archived: true })).toContain(id);
    expect(await archivedLeadCount(database, ctx, "all")).toBe(1);
    const after = await pipelineSummary(database, ctx);
    expect(after.count).toBe(before.count - 1);
    expect(after.valueMinor).toBe(before.valueMinor - 99_00n);
    expect((await leadStageTotals(database, ctx, "all")).get("proposal")?.count ?? 0).toBe(
      (totalsBefore.get("proposal")?.count ?? 0) - 1,
    );

    await setLeadArchived(database, ctx, "all", id, false);
    expect(await leadIds(ctx, "all")).toContain(id);
    const logs = await database
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "lead"), eq(auditLogs.entityId, id)));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["lead.archive", "lead.unarchive"]));
  });

  it("searches case-insensitively, word by word, with wildcards taken literally", async () => {
    const { createLead, pageLeads } = await import("./service");
    const zed = await createLead(database, ctx, lead({ name: "Zed Unique", company: "Needle Pty" }));
    const sale = await createLead(database, ctx, lead({ name: "100% Growth_Co", phone: "+61 400 111 222" }));
    expect(await leadIds(ctx, "all", { q: "NEEDLE" })).toEqual([zed]);
    expect(await leadIds(ctx, "all", { q: "needle zed" })).toEqual([zed]);
    expect(await leadIds(ctx, "all", { q: "needle growth" })).toEqual([]);
    expect(await leadIds(ctx, "all", { q: "100%" })).toEqual([sale]);
    expect(await leadIds(ctx, "all", { q: "h_c" })).toEqual([sale]);
    expect(await leadIds(ctx, "all", { q: "400 111" })).toEqual([sale]);
    // `%` and `_` are not wildcards: they only match themselves.
    expect(await leadIds(ctx, "all", { q: "Zed%Unique" })).toEqual([]);
    expect(await leadIds(ctx, "all", { q: "Z_d" })).toEqual([]);
    // Pages: newest first with a stable order, and the total of all matches.
    const all = await leadIds(ctx, "all");
    const first = await pageLeads(database, ctx, "all", {}, parsePage({ size: "25" }, { sizes: [2, 25] }));
    expect(first.total).toBe(all.length);
    const two = parsePage({ size: "2", page: "2" }, { sizes: [2] });
    expect((await pageLeads(database, ctx, "all", {}, two)).rows.map((r) => r.lead.id)).toEqual(
      all.slice(2, 4),
    );
  });

  it("caps each board column and filters the list view by stage", async () => {
    const { boardLeads, createLead, leadStageTotals } = await import("./service");
    for (let i = 0; i < 4; i++) await createLead(database, ctx, lead({ name: `Won ${i}`, stage: "won" }));
    const board = await boardLeads(database, ctx, "all", {}, 3);
    const totals = await leadStageTotals(database, ctx, "all");
    const perStage = new Map<string, number>();
    for (const r of board) perStage.set(r.lead.stage, (perStage.get(r.lead.stage) ?? 0) + 1);
    for (const [stage, shown] of perStage) expect(shown).toBe(Math.min(3, totals.get(stage)?.count ?? 0));
    expect(perStage.get("won")).toBe(3);
    expect(board.filter((r) => r.lead.stage === "won").map((r) => r.lead.name)).toEqual([
      "Won 3",
      "Won 2",
      "Won 1",
    ]);
    const wonTotal = totals.get("won")?.count ?? 0;
    expect(wonTotal).toBeGreaterThanOrEqual(4);
    expect(await leadIds(ctx, "all", { stages: ["won"] })).toHaveLength(wonTotal);
    const known = ctx.tenant.settings.pipelineStages.map((s) => s.key);
    expect(await leadIds(ctx, "all", { notStages: known })).toEqual([]);
  });
});

describe("lead follow-ups", () => {
  it("lists open leads whose follow-up day has come, most overdue first, and counts them", async () => {
    const { createLead, pipelineSummary } = await import("./service");
    const { createTestDb, setupTenant } = await import("@/server/testing/db");
    const own = await createTestDb();
    const { ctx: c } = await setupTenant(own, "follow");
    const today = "2026-06-30";
    const make = (name: string, followUpDate: string | null, stage = "new") =>
      createLead(own, c, lead({ name, followUpDate, stage }));
    const late = await make("Late", "2026-06-01");
    const dueToday = await make("Today", "2026-06-30");
    await make("Later", "2026-07-15");
    await make("None", null);
    await make("Won already", "2026-06-01", "won");
    const { pageLeads } = await import("./service");
    const page = await pageLeads(own, c, "all", { dueBy: today }, parsePage({ size: "100" }));
    expect(page.rows.map((r) => r.lead.id)).toEqual([late, dueToday]);
    expect((await pipelineSummary(own, c, today)).dueCount).toBe(2);
    expect((await pipelineSummary(own, c)).dueCount).toBe(0);
  });
});
