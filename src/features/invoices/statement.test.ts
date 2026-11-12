// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@/features/clients";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import { ageBucket } from "./statement";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

let database: Database;
let ctx: TenantContext;
let bank: string;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  const { createAccount } = await import("@/features/finance");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "stmt"));
  bank = await createAccount(database, ctx, {
    name: "Bank",
    type: "bank",
    currency: "AUD",
    openingBalanceMinor: 0n,
  });
});

const newClient = (name: string) =>
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

async function sent(clientId: string, dollars: number, issueDate: string, dueDate = issueDate) {
  const { createInvoice, sendInvoice } = await import("./service");
  const id = await createInvoice(database, ctx, {
    clientId,
    issueDate,
    dueDate,
    items: [{ description: "Work", quantity: "1", unitPriceMinor: String(dollars * 100), taxRateBp: 0 }],
    notes: "",
    custom: {},
  });
  await sendInvoice(database, ctx, id);
  return id;
}

const pay = async (id: string, amountMinor: bigint, date: string) => {
  const { recordPayment } = await import("./service");
  await recordPayment(database, ctx, id, {
    amountMinor,
    date,
    accountId: bank,
    method: "",
    categoryId: null,
  });
};

describe("ageBucket", () => {
  it("puts due-today in current and each 30-day edge in the earlier bucket", () => {
    expect(ageBucket("2026-06-30", "2026-06-30")).toBe("current");
    expect(ageBucket("2026-07-10", "2026-06-30")).toBe("current");
    expect(ageBucket("2026-06-29", "2026-06-30")).toBe("d1_30");
    expect(ageBucket("2026-05-31", "2026-06-30")).toBe("d1_30");
    expect(ageBucket("2026-05-30", "2026-06-30")).toBe("d31_60");
    expect(ageBucket("2026-04-01", "2026-06-30")).toBe("d61_90");
    // 1 April to 30 June is 90 days late; a day earlier is over 90.
    expect(ageBucket("2026-03-31", "2026-06-30")).toBe("d90");
  });
});

describe("aged receivables", () => {
  it("buckets each client's unpaid balance the same way as ageBucket", async () => {
    const { agedReceivables, agedTotals } = await import("./statement");
    const client = await newClient("Aged Co");
    const today = "2026-06-30";
    await sent(client, 100, "2026-06-01", "2026-07-15"); // not due
    await sent(client, 200, "2026-05-01", "2026-05-31"); // 30 days late
    const partly = await sent(client, 300, "2026-04-01", "2026-04-15"); // 76 days late
    await pay(partly, 10_000n, "2026-05-01");
    await sent(client, 400, "2026-01-01", "2026-01-31"); // 150 days late
    const rows = (await agedReceivables(database, ctx.tenant.id, today)).filter((r) => r.clientId === client);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.buckets).toEqual({
      current: 10_000n,
      d1_30: 20_000n,
      d31_60: 0n,
      d61_90: 20_000n,
      d90: 40_000n,
    });
    expect(rows[0]?.totalMinor).toBe(90_000n);
    const sum = agedTotals(rows).get("AUD");
    expect(sum?.totalMinor).toBe(90_000n);
  });
});

describe("client statement", () => {
  it("carries the opening balance, runs the balance and ignores drafts, voids and reversed payments", async () => {
    const { clientStatement } = await import("./statement");
    const { createInvoice, voidInvoice, getInvoice } = await import("./service");
    const { reverseTransaction } = await import("@/features/finance");
    const client = await newClient("Statement Co");
    const before = await sent(client, 500, "2026-02-10");
    await pay(before, 20_000n, "2026-02-20");
    const inRange = await sent(client, 300, "2026-03-05");
    await pay(inRange, 30_000n, "2026-03-10");
    // Reversed: it never counts.
    await pay(before, 5_000n, "2026-03-12");
    const row = await getInvoice(database, ctx.tenant.id, before);
    const reversed = row?.payments.find((p) => p.amountMinor === 5_000n);
    if (!reversed) throw new Error("payment missing");
    await reverseTransaction(database, ctx, reversed.transactionId, "2026-03-13", "bounced");
    // A void invoice and a draft never show.
    await voidInvoice(database, ctx, await sent(client, 999, "2026-03-15"));
    await createInvoice(database, ctx, {
      clientId: client,
      issueDate: "2026-03-16",
      dueDate: "2026-03-16",
      items: [{ description: "Draft", quantity: "1", unitPriceMinor: "100", taxRateBp: 0 }],
      notes: "",
      custom: {},
    });

    const [st, ...others] = await clientStatement(
      database,
      ctx.tenant.id,
      client,
      { from: "2026-03-01", to: "2026-03-31" },
      "AUD",
    );
    expect(others).toHaveLength(0);
    expect(st?.openingMinor).toBe(30_000n);
    expect(st?.invoicedMinor).toBe(30_000n);
    expect(st?.paidMinor).toBe(30_000n);
    expect(st?.closingMinor).toBe(30_000n);
    expect(st?.entries.map((e) => [e.date, e.kind, e.amountMinor, e.balanceMinor])).toEqual([
      ["2026-03-05", "invoice", 30_000n, 60_000n],
      ["2026-03-10", "payment", -30_000n, 30_000n],
    ]);
  });

  it("shows a write-off and matches the invoice balances", async () => {
    const { clientStatement } = await import("./statement");
    const { writeOffBalance } = await import("./service");
    const client = await newClient("Write-off Co");
    const id = await sent(client, 100, "2026-04-01");
    await pay(id, 9_000n, "2026-04-05");
    await writeOffBalance(database, ctx, id, "small balance");
    const [st] = await clientStatement(database, ctx.tenant.id, client, {
      from: "2026-01-01",
      to: "2099-12-31",
    });
    expect(st?.entries.map((e) => e.kind)).toEqual(["invoice", "payment", "writeOff"]);
    expect(st?.closingMinor).toBe(0n);
  });
});

describe("billing contact", () => {
  it("emails the invoice to the billing email and greets the contact person", async () => {
    const { createInvoice, sendInvoice } = await import("./service");
    const { jobs } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const client = await createClient(database, ctx, {
      name: "Billing Co",
      email: "owner@billing.test",
      contactName: "Sam",
      billingEmail: "accounts@billing.test",
      phone: "",
      website: "",
      address: "",
      notes: "",
      status: "active",
      custom: {},
    });
    const id = await createInvoice(database, ctx, {
      clientId: client,
      issueDate: "2026-05-01",
      dueDate: "2026-05-15",
      items: [{ description: "Work", quantity: "1", unitPriceMinor: "5000", taxRateBp: 0 }],
      notes: "",
      custom: {},
    });
    await sendInvoice(database, ctx, id);
    const queued = await database.select().from(jobs).where(eq(jobs.tenantId, ctx.tenant.id));
    const mail = queued
      .map((j) => j.payload as { to?: string; text?: string })
      .find((p) => p.to === "accounts@billing.test");
    expect(mail?.text).toContain("Sam");
    expect(queued.some((j) => (j.payload as { to?: string }).to === "owner@billing.test")).toBe(false);
  });
});

describe("payment dates", () => {
  it("refuses a payment dated in the future, so the statement and the balance agree", async () => {
    const { addDays, today } = await import("@/lib/dates");
    const id = await sent(await newClient("Future Co"), 100, "2020-03-01");
    const tomorrow = addDays(today(ctx.tenant.settings.timezone), 1);
    await expect(pay(id, 10_000n, tomorrow)).rejects.toThrow("in the future");
    await pay(id, 10_000n, today(ctx.tenant.settings.timezone));
  });
});

describe("payment reminders", () => {
  const settings = { enabled: true, daysBefore: 3, daysAfter: [14, 1, 7, 7] };

  it("plans reminder days around the due date and skips the ones already past", async () => {
    const { reminderPlan, reminderSteps } = await import("./service");
    expect(reminderSteps(settings)).toEqual([-3, 1, 7, 14]);
    expect(reminderSteps({ ...settings, enabled: false })).toEqual([]);
    expect(reminderPlan("2026-06-30", "2026-06-01", settings)).toEqual({ count: 0, next: "2026-06-27" });
    // Sent late: the early reminder and day 1 are behind, day 7 is next.
    expect(reminderPlan("2026-06-30", "2026-07-03", settings)).toEqual({ count: 2, next: "2026-07-07" });
    expect(reminderPlan("2026-06-30", "2026-08-01", settings)).toEqual({ count: 4, next: null });
  });

  it("reminds once per due day while unpaid, then stops when paid", async () => {
    const { runReminders } = await import("./service");
    const { invoices, jobs } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const client = await newClient("Reminder Co");
    const id = await sent(client, 100, "2020-01-01", "2020-01-31");
    const tenant = { ...ctx.tenant, settings: { ...ctx.tenant.settings, reminders: settings } };
    // Sent long after every reminder day: nothing is planned.
    const [after] = await database.select().from(invoices).where(eq(invoices.id, id));
    expect(after?.nextReminderOn).toBeNull();
    // Plan one by hand (day 7) and run on that day: one reminder, then day 14 is next.
    await database
      .update(invoices)
      .set({ nextReminderOn: "2020-02-07", reminderCount: 2 })
      .where(eq(invoices.id, id));
    const before = (await database.select().from(jobs)).length;
    expect(await runReminders(database, tenant, "2020-02-07")).toBe(1);
    expect(await runReminders(database, tenant, "2020-02-07")).toBe(0);
    const [planned] = await database.select().from(invoices).where(eq(invoices.id, id));
    expect(planned?.nextReminderOn).toBe("2020-02-14");
    expect((await database.select().from(jobs)).length).toBeGreaterThanOrEqual(before);
    await pay(id, 10_000n, "2020-02-10");
    expect(await runReminders(database, tenant, "2020-02-14")).toBe(0);
  });

  it("never repeats a reminder already sent today when the settings are saved", async () => {
    const { runReminders, replanReminders } = await import("./service");
    const { invoices } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const id = await sent(await newClient("Replan Co"), 100, "2020-01-01", "2020-01-31");
    const tenant = { ...ctx.tenant, settings: { ...ctx.tenant.settings, reminders: settings } };
    const planFor = async () =>
      (await database.select().from(invoices).where(eq(invoices.id, id)))[0]?.nextReminderOn;
    // Day 7's reminder is waiting: saving settings before the job runs keeps it.
    await database.update(invoices).set({ nextReminderOn: "2020-02-07" }).where(eq(invoices.id, id));
    await replanReminders(database, tenant, "2020-02-07");
    expect(await planFor()).toBe("2020-02-07");
    // Sent at 00:05; saved again at 10:00: the next one stays day 14, nothing goes twice.
    expect(await runReminders(database, tenant, "2020-02-07")).toBe(1);
    await replanReminders(database, tenant, "2020-02-07");
    expect(await planFor()).toBe("2020-02-14");
    expect(await runReminders(database, tenant, "2020-02-07")).toBe(0);
  });
});
