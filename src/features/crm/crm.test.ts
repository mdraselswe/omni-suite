// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import { carryCustomValues } from "./carry-custom";
import type { LeadInput } from "./service";

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
    const { createLead, listLeads, moveLead, setLeadArchived } = await import("./service");
    const ownersLead = await createLead(database, ctx, lead({ name: "Owner's lead" }));
    const mine = await createLead(database, manager.ctx, lead({ name: "Mia's lead" }));
    const visible = (await listLeads(database, manager.ctx, "own")).map((r) => r.lead.id);
    expect(visible).toContain(mine);
    expect(visible).not.toContain(ownersLead);
    await expect(moveLead(database, manager.ctx, "own", ownersLead, "call")).rejects.toThrow();
    await expect(setLeadArchived(database, manager.ctx, "own", ownersLead, true)).rejects.toThrow();
    await moveLead(database, manager.ctx, "own", mine, "call");
  });

  it("archives leads out of the board and totals, and restores them", async () => {
    const { auditLogs } = await import("@/server/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const { archivedLeadCount, createLead, leadStageTotals, listLeads, pipelineSummary, setLeadArchived } =
      await import("./service");
    const id = await createLead(
      database,
      ctx,
      lead({ name: "Spam Sender", stage: "proposal", valueMinor: 99_00n }),
    );
    const before = await pipelineSummary(database, ctx);
    const totalsBefore = await leadStageTotals(database, ctx, "all");

    await setLeadArchived(database, ctx, "all", id, true);
    expect((await listLeads(database, ctx, "all")).some((r) => r.lead.id === id)).toBe(false);
    expect((await listLeads(database, ctx, "all", { archived: true })).some((r) => r.lead.id === id)).toBe(
      true,
    );
    expect(await archivedLeadCount(database, ctx, "all")).toBe(1);
    const after = await pipelineSummary(database, ctx);
    expect(after.count).toBe(before.count - 1);
    expect(after.valueMinor).toBe(before.valueMinor - 99_00n);
    expect((await leadStageTotals(database, ctx, "all")).get("proposal")?.count ?? 0).toBe(
      (totalsBefore.get("proposal")?.count ?? 0) - 1,
    );

    await setLeadArchived(database, ctx, "all", id, false);
    expect((await listLeads(database, ctx, "all")).some((r) => r.lead.id === id)).toBe(true);
    const logs = await database
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "lead"), eq(auditLogs.entityId, id)));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["lead.archive", "lead.unarchive"]));
  });

  it("searches and limits the list", async () => {
    const { createLead, listLeads } = await import("./service");
    await createLead(database, ctx, lead({ name: "Zed Unique", company: "Needle Pty" }));
    const found = await listLeads(database, ctx, "all", { q: "needle" });
    expect(found.map((r) => r.lead.name)).toEqual(["Zed Unique"]);
    expect(await listLeads(database, ctx, "all", { q: "%" })).not.toHaveLength(0);
    expect(await listLeads(database, ctx, "all", { limit: 2 })).toHaveLength(2);
  });
});
