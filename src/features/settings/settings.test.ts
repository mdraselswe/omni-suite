// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

let database: Database;
let a: TenantContext;
let b: TenantContext;
const SECRET = "test-secret-0123456789";

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx: a } = await setupTenant(database, "alpha"));
  ({ ctx: b } = await setupTenant(database, "bravo"));
});

describe("custom domain claims", () => {
  it("an unverified claim can't squat a domain; DNS proof wins; verified domains are locked", async () => {
    const { addDomain, domainToken, listDomains, tenantForHost } = await import("./service");
    const none = async () => [] as string[][];
    await addDomain(database, a, "shop.example.com", "app.example.com", { secret: SECRET, lookup: none });
    await expect(
      addDomain(database, a, "shop.example.com", "app.example.com", { secret: SECRET, lookup: none }),
    ).rejects.toThrow();

    // Bravo can't take the domain without proving ownership…
    await expect(
      addDomain(database, b, "shop.example.com", "app.example.com", { secret: SECRET, lookup: none }),
    ).rejects.toThrow(/TXT/);
    // …but with its own TXT record in place it takes over the stale claim, already verified.
    const bravoToken = domainToken(SECRET, b.tenant.id, "shop.example.com");
    const asked: string[] = [];
    await addDomain(database, b, "shop.example.com", "app.example.com", {
      secret: SECRET,
      lookup: async (name) => {
        asked.push(name);
        return [[bravoToken]];
      },
    });
    expect(asked).toEqual(["_omnisuite.shop.example.com"]);
    expect(await listDomains(database, a.tenant.id)).toHaveLength(0);
    expect(await tenantForHost(database, "shop.example.com")).toEqual({
      slug: "bravo",
      tenantId: b.tenant.id,
    });

    // Once verified, nobody else can claim it, even with a matching record of their own.
    const alphaToken = domainToken(SECRET, a.tenant.id, "shop.example.com");
    await expect(
      addDomain(database, a, "shop.example.com", "app.example.com", {
        secret: SECRET,
        lookup: async () => [[alphaToken]],
      }),
    ).rejects.toThrow();
  });

  it("gives each business a stable token of its own per hostname", async () => {
    const { domainToken } = await import("./service");
    const token = domainToken(SECRET, a.tenant.id, "x.example.com");
    expect(domainToken(SECRET, a.tenant.id, "x.example.com")).toBe(token);
    expect(domainToken(SECRET, b.tenant.id, "x.example.com")).not.toBe(token);
    expect(token.startsWith("omnisuite-verify=")).toBe(true);
  });
});

describe("business currency", () => {
  it("can change until money is recorded, then is locked", async () => {
    const { setupTenant } = await import("@/server/testing/db");
    const { buildTenantContext } = await import("@/server/tenancy/service");
    const { moneyRecorded, updateSettings } = await import("./service");
    const { createTransaction, listAccounts } = await import("@/features/finance");
    const { ctx, ownerId } = await setupTenant(database, "charlie");
    const fresh = async () => {
      const r = await buildTenantContext(database, "charlie", ownerId, false);
      if (!r.ok) throw new Error("context failed");
      return r.ctx;
    };

    expect(await moneyRecorded(database, ctx.tenant.id)).toBe(false);
    await updateSettings(database, ctx, { settings: { currency: "BDT" } });
    const bdt = await fresh();
    expect(bdt.tenant.settings.currency).toBe("BDT");

    const [cash] = await listAccounts(database, ctx.tenant.id);
    if (!cash) throw new Error("no cash account");
    await createTransaction(database, bdt, {
      kind: "expense",
      accountId: cash.id,
      date: "2026-07-01",
      description: "Tea",
      amountMinor: 5000n,
      fxRate: "0.0127",
    });
    expect(await moneyRecorded(database, ctx.tenant.id)).toBe(true);
    await expect(updateSettings(database, bdt, { settings: { currency: "AUD" } })).rejects.toThrow(
      /can't change/,
    );
    // Other settings still save, and resending the same currency is fine.
    await updateSettings(database, bdt, { settings: { currency: "BDT", timezone: "Asia/Dhaka" } });
    expect((await fresh()).tenant.settings).toMatchObject({ currency: "BDT", timezone: "Asia/Dhaka" });
    // Another business is unaffected.
    expect(await moneyRecorded(database, b.tenant.id)).toBe(false);
  });
});

describe("custom fields", () => {
  it("edits label, choices and required, and keeps the key and type", async () => {
    const { addCustomField, listCustomFields, updateCustomField } = await import("./service");
    await addCustomField(database, a, {
      entity: "client",
      label: "Tier",
      type: "select",
      options: ["Gold"],
      required: false,
    });
    const [field] = await listCustomFields(database, a.tenant.id);
    if (!field) throw new Error("no field");
    await updateCustomField(database, a, field.id, {
      label: "Plan tier",
      options: ["Gold", "Silver", "Gold"],
      required: true,
    });
    const [after] = await listCustomFields(database, a.tenant.id);
    expect(after).toMatchObject({
      key: field.key,
      type: "select",
      label: "Plan tier",
      options: ["Gold", "Silver"],
      required: true,
    });
    await expect(
      updateCustomField(database, a, field.id, { label: "Tier", options: [], required: false }),
    ).rejects.toThrow();
    // Another business can't touch it.
    await expect(
      updateCustomField(database, b, field.id, { label: "Hijack", options: ["x"], required: false }),
    ).rejects.toThrow();
  });

  it("reorders fields within one record type", async () => {
    const { addCustomField, listCustomFields, moveCustomField } = await import("./service");
    for (const label of ["First", "Second", "Third"]) {
      await addCustomField(database, b, {
        entity: "lead",
        label,
        type: "text",
        options: [],
        required: false,
      });
    }
    const labels = async () =>
      (await listCustomFields(database, b.tenant.id)).filter((f) => f.entity === "lead").map((f) => f.label);
    const third = (await listCustomFields(database, b.tenant.id)).find((f) => f.label === "Third");
    if (!third) throw new Error("no field");
    await moveCustomField(database, b, third.id, "up");
    expect(await labels()).toEqual(["First", "Third", "Second"]);
    await moveCustomField(database, b, third.id, "up");
    await moveCustomField(database, b, third.id, "up"); // already first: no change
    expect(await labels()).toEqual(["Third", "First", "Second"]);
  });
});

describe("pipeline stages", () => {
  it("won't remove a stage that leads still use", async () => {
    const { leads } = await import("@/server/db/schema");
    const { updatePipeline } = await import("./service");
    const { buildTenantContext } = await import("@/server/tenancy/service");
    const { pipelineStages, projectStatuses } = a.tenant.settings;
    const [used, unused] = pipelineStages;
    if (!used || !unused) throw new Error("need two stages");
    await database.insert(leads).values({ tenantId: a.tenant.id, name: "Lead", stage: used.key });

    await expect(
      updatePipeline(database, a, {
        pipelineStages: pipelineStages.filter((s) => s.key !== used.key),
        projectStatuses,
      }),
    ).rejects.toThrow(/1 lead/);

    await updatePipeline(database, a, {
      pipelineStages: pipelineStages.filter((s) => s.key !== unused.key),
      projectStatuses,
    });
    const fresh = await buildTenantContext(database, "alpha", a.user.id, false);
    if (!fresh.ok) throw new Error("context failed");
    expect(fresh.ctx.tenant.settings.pipelineStages.map((s) => s.key)).not.toContain(unused.key);
  });
});
