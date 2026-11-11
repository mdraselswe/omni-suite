// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import { createTestDb, setupTenant } from "@/server/testing/db";
import type { TenantContext } from "@/server/tenancy/context";
import { createAccount, createTransaction } from "@/features/finance";
import {
  computeDistribution,
  createPartner,
  decideRule,
  listPartners,
  listRules,
  partnerStatement,
  proposeRule,
  recordCapital,
  recordInvestment,
  saveDistribution,
  setInitialOwnership,
} from "./service";

let database: Database;
let ctx: TenantContext;
let bank: string;
let a: string;
let b: string;

beforeAll(async () => {
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "ptn"));
  bank = await createAccount(database, ctx, {
    name: "Bank",
    type: "bank",
    currency: "AUD",
    openingBalanceMinor: 0n,
  });
  a = await createPartner(database, ctx, {
    name: "A",
    email: "",
    joinedOn: "2026-07-01",
    membershipId: ctx.membership.id,
  });
  b = await createPartner(database, ctx, {
    name: "B",
    email: "",
    joinedOn: "2026-07-01",
    membershipId: null,
  });
});

describe("partners and profit", () => {
  it("records capital and ownership", async () => {
    await recordCapital(database, ctx, {
      partnerId: a,
      date: "2026-07-01",
      kind: "cash",
      amountMinor: 3000000n,
      description: "",
      accountId: bank,
    });
    await recordCapital(database, ctx, {
      partnerId: b,
      date: "2026-07-01",
      kind: "work",
      amountMinor: 2000000n,
      description: "",
      accountId: null,
    });
    await setInitialOwnership(database, ctx, {
      date: "2026-07-01",
      note: "",
      shares: [
        { partnerId: a, basisPoints: 6000 },
        { partnerId: b, basisPoints: 4000 },
      ],
    });
    const list = await listPartners(database, ctx.tenant.id, "2026-07-15");
    expect(list.map((p) => [p.name, p.ownershipBp, p.capitalMinor])).toEqual([
      ["A", 6000, 3000000n],
      ["B", 4000, 2000000n],
    ]);
  });

  it("activates a rule only after every partner approves", async () => {
    const id = await proposeRule(database, ctx, {
      effectiveFrom: "2026-07-01",
      note: "",
      config: { reserveBp: 0, fees: [], method: { type: "ownership_units" }, lossMethod: "same_as_profit" },
    });
    let rules = await listRules(database, ctx.tenant.id);
    expect(rules[0]?.status).toBe("proposed"); // A approved automatically, B pending
    await decideRule(database, ctx, { ruleId: id, partnerId: b, decision: "approved" }); // recorded on B's behalf
    rules = await listRules(database, ctx.tenant.id);
    expect(rules[0]?.status).toBe("active");
  });

  it("splits profit by ownership and across a mid-period investment", async () => {
    await createTransaction(database, ctx, {
      kind: "income",
      accountId: bank,
      date: "2026-07-10",
      description: "",
      amountMinor: 10000000n,
    });
    await createTransaction(database, ctx, {
      kind: "expense",
      accountId: bank,
      date: "2026-07-11",
      description: "",
      amountMinor: 4000000n,
    });
    const july = await computeDistribution(database, ctx.tenant.id, {
      start: "2026-07-01",
      end: "2026-07-31",
      manualLabor: {},
    });
    expect(july.total.lines.map((l) => l.totalMinor)).toEqual([3600000n, 2400000n]);

    const c = await createPartner(database, ctx, {
      name: "C",
      email: "",
      joinedOn: "2026-08-16",
      membershipId: null,
    });
    await recordInvestment(database, ctx, {
      partnerId: c,
      date: "2026-08-16",
      preMoneyMinor: 12000000n,
      investmentMinor: 4000000n,
      accountId: bank,
      note: "",
    });
    const after = await listPartners(database, ctx.tenant.id, "2026-08-20");
    expect(after.map((p) => p.ownershipBp)).toEqual([4500, 3000, 2500]);

    await createTransaction(database, ctx, {
      kind: "income",
      accountId: bank,
      date: "2026-08-05",
      description: "",
      amountMinor: 1000000n,
    });
    await createTransaction(database, ctx, {
      kind: "income",
      accountId: bank,
      date: "2026-08-20",
      description: "",
      amountMinor: 1000000n,
    });
    const aug = await computeDistribution(database, ctx.tenant.id, {
      start: "2026-08-01",
      end: "2026-08-31",
      manualLabor: {},
    });
    expect(aug.segments).toHaveLength(2);
    const byName = Object.fromEntries(
      aug.total.lines.map((l) => [aug.partnerNames[l.partnerId], l.totalMinor]),
    );
    expect(byName).toEqual({ A: 600000n + 450000n, B: 400000n + 300000n, C: 250000n });

    await saveDistribution(database, ctx, {
      start: "2026-07-01",
      end: "2026-07-31",
      manualLabor: {},
      final: true,
    });
    await expect(
      saveDistribution(database, ctx, {
        start: "2026-07-15",
        end: "2026-08-15",
        manualLabor: {},
        final: true,
      }),
    ).rejects.toThrow();
    const statement = await partnerStatement(database, ctx.tenant.id, a);
    expect(statement.sharesMinor).toBe(3600000n);
    expect(statement.capitalMinor).toBe(3000000n);
  });
});
