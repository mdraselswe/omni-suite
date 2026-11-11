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
    const first = await seed(database, { adminEmails: ["admin@example.com"] });
    expect(first).toEqual({ demo: "created", home: "created" });

    const { tenants, memberships, invoices, partners, profitRules } = await import("@/server/db/schema");
    const [demo] = await database.select().from(tenants).where(eq(tenants.slug, "demo"));
    expect(demo).toBeDefined();
    const tenantId = demo?.id ?? "";

    const members = await database.select().from(memberships).where(eq(memberships.tenantId, tenantId));
    expect(members).toHaveLength(7); // six demo sign-ins + the platform admin
    expect(members.filter((m) => m.kind === "client")).toHaveLength(1);

    const invs = await database.select().from(invoices).where(eq(invoices.tenantId, tenantId));
    expect(invs.filter((i) => i.status === "paid")).toHaveLength(5);
    expect(invs.some((i) => i.status === "draft")).toBe(true);
    expect(invs.some((i) => i.status === "partially_paid")).toBe(true);

    expect(await database.select().from(partners).where(eq(partners.tenantId, tenantId))).toHaveLength(2);
    const rules = await database.select().from(profitRules).where(eq(profitRules.tenantId, tenantId));
    expect(rules.map((r) => r.status)).toEqual(["active"]);

    const { listAccounts } = await import("@/features/finance");
    const bank = (await listAccounts(database, tenantId)).find((a) => a.name === "Business bank");
    expect(bank && bank.balanceMinor > 0n).toBe(true);

    const second = await seed(database, { adminEmails: ["admin@example.com"] });
    expect(second).toEqual({ demo: "exists", home: "exists" });
  }, 60_000);
});
