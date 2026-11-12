// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@/features/clients";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

let database: Database;
let ctx: TenantContext;
let other: TenantContext;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "share"));
  ({ ctx: other } = await setupTenant(database, "share-other"));
});

const newClient = (c: TenantContext, name: string, email = "") =>
  createClient(database, c, {
    name,
    email,
    phone: "",
    website: "",
    address: "",
    notes: "",
    status: "active",
    custom: {},
  });

async function draftInvoice(c: TenantContext, name: string) {
  const { createInvoice } = await import("@/features/invoices");
  return createInvoice(database, c, {
    clientId: await newClient(c, name, `${name.toLowerCase().replace(/\W/g, "")}@example.com`),
    issueDate: "2026-07-01",
    dueDate: "2026-07-15",
    items: [{ description: "Work", quantity: "1", unitPriceMinor: "100000", taxRateBp: 1000 }],
    notes: "",
    custom: {},
  });
}

async function sentProposal(name: string, terms = "", validUntil: string | null = null) {
  const { createProposal, sendProposal } = await import("@/features/proposals");
  const id = await createProposal(database, ctx, {
    clientId: await newClient(ctx, name, `${name.toLowerCase().replace(/\W/g, "")}@example.com`),
    title: `Website for ${name}`,
    intro: "",
    terms,
    items: [{ description: "Build", quantity: "1", unitPriceMinor: "200000", taxRateBp: 1000 }],
    validUntil,
  });
  await sendProposal(database, ctx, id);
  return id;
}

const tokenOf = (url: string) => url.split("/").filter(Boolean).pop() ?? "";

/** Text of the mails queued to one address. */
async function mailsTo(address: string): Promise<string[]> {
  const { jobs } = await import("@/server/db/schema");
  const rows = await database.select().from(jobs);
  return rows
    .map((r) => r.payload as { to?: string; text?: string })
    .filter((p) => p.to === address)
    .map((p) => p.text ?? "");
}

describe("share links", () => {
  it("puts a link in the invoice email that opens only that invoice", async () => {
    const { sendInvoice } = await import("@/features/invoices");
    const { sharedInvoice } = await import("./service");
    const id = await draftInvoice(ctx, "Mail Co");
    // A draft has no link yet and can't be opened by guessing.
    expect(await sharedInvoice(database, "A".repeat(32))).toBeNull();
    await sendInvoice(database, ctx, id);
    const [text] = await mailsTo("mailco@example.com");
    const match = text?.match(/\/p\/invoice\/([A-Za-z0-9_-]{32})\//);
    expect(match).toBeTruthy();
    const shared = await sharedInvoice(database, match?.[1] ?? "");
    expect(shared?.invoice.id).toBe(id);
    expect(shared?.tenant.id).toBe(ctx.tenant.id);
    expect(shared?.payable).toBe(false); // no Stripe connected
    // Malformed tokens are not looked up at all.
    expect(await sharedInvoice(database, "' or 1=1 --")).toBeNull();
  });

  it("refuses drafts, and a reset stops the old link", async () => {
    const { sendInvoice } = await import("@/features/invoices");
    const { shareLinkFor, sharedInvoice } = await import("./service");
    const id = await draftInvoice(ctx, "Reset Co");
    await expect(shareLinkFor(database, ctx, "invoice", id)).rejects.toThrow("draft");
    await sendInvoice(database, ctx, id);
    const first = tokenOf(await shareLinkFor(database, ctx, "invoice", id));
    // Asking again gives the same link; a reset gives a new one.
    expect(tokenOf(await shareLinkFor(database, ctx, "invoice", id))).toBe(first);
    const second = tokenOf(await shareLinkFor(database, ctx, "invoice", id, true));
    expect(second).not.toBe(first);
    expect(await sharedInvoice(database, first)).toBeNull();
    expect((await sharedInvoice(database, second))?.invoice.id).toBe(id);
    // Another business can't make or reset links for it.
    await expect(shareLinkFor(database, other, "invoice", id, true)).rejects.toThrow("not found");
  });

  it("closes the link while the business is suspended or invoices are switched off", async () => {
    const { sendInvoice } = await import("@/features/invoices");
    const { shareLinkFor, sharedInvoice } = await import("./service");
    const { tenants } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const id = await draftInvoice(other, "Suspended Co");
    await sendInvoice(database, other, id);
    const token = tokenOf(await shareLinkFor(database, other, "invoice", id));
    await database.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, other.tenant.id));
    expect(await sharedInvoice(database, token)).toBeNull();
    await database.update(tenants).set({ status: "active" }).where(eq(tenants.id, other.tenant.id));
    expect(await sharedInvoice(database, token)).not.toBeNull();
  });

  it("lets the client accept a proposal through the link, once", async () => {
    const { getProposal } = await import("@/features/proposals");
    const { respondToSharedProposal, sharedProposal } = await import("./service");
    const id = await sentProposal("Accept Co", "50% deposit up front");
    const [text] = await mailsTo("acceptco@example.com");
    const token = text?.match(/\/p\/proposal\/([A-Za-z0-9_-]{32})\//)?.[1] ?? "";
    expect((await sharedProposal(database, token))?.proposal.id).toBe(id);
    const answer = { accept: true, name: "Mia Chen", ip: "203.0.113.5" };
    // Terms must be ticked.
    await expect(respondToSharedProposal(database, token, answer)).rejects.toThrow();
    await respondToSharedProposal(database, token, { ...answer, acceptTerms: true });
    const row = await getProposal(database, ctx.tenant.id, id);
    expect(row?.proposal).toMatchObject({ status: "accepted", respondedByName: "Mia Chen" });
    // Already answered: a second answer is refused.
    await expect(
      respondToSharedProposal(database, token, { accept: false, name: "Someone", ip: "", reason: "" }),
    ).rejects.toThrow();
    const { auditLogs } = await import("@/server/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const [log] = await database
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, "proposal.accept")));
    expect(log).toMatchObject({ actorUserId: null, data: expect.objectContaining({ via: "link" }) });
  });

  it("refuses an expired proposal and an unknown link", async () => {
    const { respondToSharedProposal, shareLinkFor } = await import("./service");
    const id = await sentProposal("Expired Co", "", "2026-01-01");
    const token = tokenOf(await shareLinkFor(database, ctx, "proposal", id));
    await expect(
      respondToSharedProposal(database, token, { accept: true, name: "Late", ip: "" }),
    ).rejects.toThrow("expired");
    await expect(
      respondToSharedProposal(database, "B".repeat(32), { accept: true, name: "X", ip: "" }),
    ).rejects.toThrow("no longer works");
  });
});
