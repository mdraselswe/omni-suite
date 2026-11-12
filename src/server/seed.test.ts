// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";

vi.mock("@/server/mail", () => ({
  sendMail: vi.fn(async () => true),
  appUrl: (p: string) => `http://localhost:3000${p}`,
}));

let database: Database;

beforeAll(async () => {
  const { createTestDb } = await import("@/server/testing/db");
  database = await createTestDb();
});

describe("seed", () => {
  it("creates the demo business with consistent sample data, and is safe to run twice", async () => {
    const { seed } = await import("./seed");
    const first = await seed(database, { adminEmails: ["admin@example.com", "owner@demo.test"] });
    expect(first).toEqual({ demo: "created", home: "created" });

    const { tenants, memberships, invoices, partners, profitRules } = await import("@/server/db/schema");
    const [demo] = await database.select().from(tenants).where(eq(tenants.slug, "demo"));
    expect(demo).toBeDefined();
    const tenantId = demo?.id ?? "";

    const members = await database.select().from(memberships).where(eq(memberships.tenantId, tenantId));
    expect(members).toHaveLength(8); // seven demo sign-ins + the platform admin
    expect(members.filter((m) => m.kind === "client")).toHaveLength(2);

    const invs = await database.select().from(invoices).where(eq(invoices.tenantId, tenantId));
    // 5 cafe + 7 gym retainer months, all paid; plus one of every other state.
    expect(invs.filter((i) => i.status === "paid")).toHaveLength(12);
    for (const status of ["draft", "partially_paid", "sent", "void"] as const) {
      expect(
        invs.some((i) => i.status === status),
        status,
      ).toBe(true);
    }
    const { today } = await import("@/lib/dates");
    const { parseTenantSettings } = await import("@/lib/tenant-settings");
    const day = today(parseTenantSettings(demo?.settings).timezone);
    expect(invs.some((i) => i.status === "sent" && i.dueDate < day)).toBe(true); // overdue
    // Stored totals agree with what was paid.
    for (const i of invs) {
      if (i.status === "paid") expect(i.paidMinor).toBe(i.totalMinor);
      expect(i.paidMinor <= i.totalMinor).toBe(true);
    }

    const { invitations, onboardingRequests, periods, proposals } = await import("@/server/db/schema");
    const forms = await database
      .select()
      .from(onboardingRequests)
      .where(eq(onboardingRequests.tenantId, tenantId));
    expect(forms.map((f) => f.status).sort()).toEqual(["sent", "submitted"]);
    const invites = await database.select().from(invitations).where(eq(invitations.tenantId, tenantId));
    expect(invites.some((v) => v.email === "jordan@bondifit.example")).toBe(true);
    const props = await database.select().from(proposals).where(eq(proposals.tenantId, tenantId));
    for (const status of ["accepted", "declined", "sent"]) {
      expect(
        props.some((p) => p.status === status),
        status,
      ).toBe(true);
    }
    expect(await database.select().from(periods).where(eq(periods.tenantId, tenantId))).toHaveLength(1);

    // A credit note, share links (the gym has no portal login, so its invoice mails carry one).
    const { invoiceAdjustments, bills } = await import("@/server/db/schema");
    const notes = await database
      .select()
      .from(invoiceAdjustments)
      .where(eq(invoiceAdjustments.tenantId, tenantId));
    expect(notes.map((n) => [n.kind, n.number, n.amountMinor])).toEqual([
      ["credit_note", "CN-0001", 30_000n],
    ]);
    const credited = invs.find((i) => i.creditedMinor > 0n);
    expect(credited && credited.paidMinor + credited.creditedMinor < credited.totalMinor).toBe(true);
    expect(invs.filter((i) => i.shareToken).length).toBeGreaterThan(1);
    // Supplier bills: one paid, one part paid, one overdue.
    expect(await database.select().from(bills).where(eq(bills.tenantId, tenantId))).toHaveLength(3);
    const { payables } = await import("@/features/bills");
    const owed = await payables(database, tenantId, day, "AUD");
    expect(owed.base).toMatchObject({ owedMinor: 187_000n, overdueMinor: 77_000n, count: 2 });

    expect(await database.select().from(partners).where(eq(partners.tenantId, tenantId))).toHaveLength(2);
    const rules = await database.select().from(profitRules).where(eq(profitRules.tenantId, tenantId));
    expect(rules.map((r) => r.status)).toEqual(["active"]);

    const { listAccounts } = await import("@/features/finance");
    const accounts = await listAccounts(database, tenantId);
    const bank = accounts.find((a) => a.name === "Business bank");
    expect(bank && bank.balanceMinor > 0n).toBe(true);
    // No bank or cash account is overdrawn (Dhaka is topped up before salaries go out).
    // The card owes this month's charge until it is paid off, so its balance is below zero.
    for (const a of accounts) {
      if (a.type === "card") expect(a.balanceMinor <= 0n, a.name).toBe(true);
      else expect(a.balanceMinor >= 0n, a.name).toBe(true);
    }

    // owner@demo.test is also a platform admin above: it keeps its demo name and password.
    const { account, user } = await import("@/server/db/schema");
    const ownerLogins = await database
      .select({ provider: account.providerId, name: user.name })
      .from(account)
      .innerJoin(user, eq(user.id, account.userId))
      .where(eq(user.email, "owner@demo.test"));
    expect(ownerLogins).toEqual([{ provider: "credential", name: "Ayesha Rahman" }]);

    const second = await seed(database, { adminEmails: ["admin@example.com"] });
    expect(second).toEqual({ demo: "exists", home: "exists" });
  }, 60_000);
});
