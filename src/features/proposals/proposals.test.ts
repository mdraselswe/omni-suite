// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@/features/clients";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import { proposalDisplayStatus } from "./status";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

let database: Database;
let ctx: TenantContext;
let clientId: string;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ ctx } = await setupTenant(database, "prop"));
  clientId = await createClient(database, ctx, {
    name: "Harbour Cafe",
    email: "",
    phone: "",
    website: "",
    address: "",
    notes: "",
    status: "active",
    custom: {},
  });
});

async function acceptedProposal(title: string) {
  const { createProposal, sendProposal, respondToProposal } = await import("./service");
  const id = await createProposal(database, ctx, {
    clientId,
    title,
    intro: "A new website",
    terms: "",
    items: [
      { description: "Design", quantity: "1", unitPriceMinor: "300000", taxRateBp: 1000 },
      { description: "Build", quantity: "1", unitPriceMinor: "500000", taxRateBp: 1000 },
    ],
    validUntil: null,
  });
  await sendProposal(database, ctx, id);
  await respondToProposal(database, ctx, id, {
    accept: true,
    name: "Mia",
    ip: "127.0.0.1",
    today: "2026-07-01",
  });
  return id;
}

describe("from an accepted proposal", () => {
  it("bills a deposit, then the rest, and never more than the proposal", async () => {
    const { invoiceFromProposal, proposalBilling, getProposal } = await import("./service");
    const { getInvoice } = await import("@/features/invoices");
    const id = await acceptedProposal("Website");
    const deposit = await invoiceFromProposal(database, ctx, id, "2026-07-02", { depositBp: 5000 });
    expect((await getInvoice(database, ctx.tenant.id, deposit))?.invoice).toMatchObject({
      subtotalMinor: 400_000n,
      taxMinor: 40_000n,
      totalMinor: 440_000n,
    });
    // A second deposit isn't allowed once something is billed.
    await expect(invoiceFromProposal(database, ctx, id, "2026-07-02", { depositBp: 2000 })).rejects.toThrow();
    const rest = await invoiceFromProposal(database, ctx, id, "2026-08-01");
    expect((await getInvoice(database, ctx.tenant.id, rest))?.invoice).toMatchObject({
      subtotalMinor: 400_000n,
      totalMinor: 440_000n,
    });
    const p = await getProposal(database, ctx.tenant.id, id);
    if (!p) throw new Error("missing");
    const billing = await proposalBilling(database, ctx.tenant.id, p.proposal);
    expect(billing.remainingMinor).toBe(0n);
    expect(billing.invoices).toHaveLength(2);
    await expect(invoiceFromProposal(database, ctx, id, "2026-08-02")).rejects.toThrow();
  });

  it("starts one project with the proposal's client and value", async () => {
    const { projectFromProposal, projectForProposal } = await import("./service");
    const id = await acceptedProposal("Brand refresh");
    const project = await projectFromProposal(database, ctx, id, "2026-07-03");
    expect(await projectFromProposal(database, ctx, id, "2026-07-03")).toBe(project);
    expect(await projectForProposal(database, ctx.tenant.id, id)).toMatchObject({
      id: project,
      name: "Brand refresh",
    });
  });
});

describe("display status", () => {
  it("shows a sent proposal past its last valid day as expired", () => {
    expect(proposalDisplayStatus({ status: "sent", validUntil: "2026-07-01" }, "2026-07-01")).toBe("sent");
    expect(proposalDisplayStatus({ status: "sent", validUntil: "2026-07-01" }, "2026-07-02")).toBe("expired");
    expect(proposalDisplayStatus({ status: "sent", validUntil: null }, "2030-01-01")).toBe("sent");
    expect(proposalDisplayStatus({ status: "accepted", validUntil: "2026-07-01" }, "2026-08-01")).toBe(
      "accepted",
    );
  });
});

describe("client responses", () => {
  let portal: TenantContext;
  let portalMembership: string;

  beforeAll(async () => {
    const { addMember } = await import("@/server/testing/db");
    ({ ctx: portal, membershipId: portalMembership } = await addMember(
      database,
      "prop",
      "client_owner",
      "Pia Portal",
      { kind: "client", clientId },
    ));
  });

  it("only notifies portal users who can open the portal", async () => {
    const { clientUserIds } = await import("@/server/shared");
    const { memberOverrides } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    expect(await clientUserIds(database, ctx.tenant.id, clientId, "portal.proposals")).toEqual([
      portal.user.id,
    ]);
    // Portal switched off for this person: no email with a link they could not open.
    await database.insert(memberOverrides).values({
      tenantId: ctx.tenant.id,
      membershipId: portalMembership,
      permission: "portal.access",
      effect: "deny",
      scope: "all",
    });
    expect(await clientUserIds(database, ctx.tenant.id, clientId, "portal.proposals")).toEqual([]);
    await database.delete(memberOverrides).where(eq(memberOverrides.membershipId, portalMembership));
  });

  async function sentProposal(input: { terms?: string; validUntil?: string | null } = {}) {
    const { createProposal, sendProposal } = await import("./service");
    const id = await createProposal(database, ctx, {
      clientId,
      title: "Logo",
      intro: "",
      terms: input.terms ?? "",
      items: [{ description: "Logo", quantity: "1", unitPriceMinor: "100000", taxRateBp: 0 }],
      validUntil: input.validUntil ?? null,
    });
    await sendProposal(database, ctx, id);
    return id;
  }

  it("needs the terms ticked before accepting a proposal with terms", async () => {
    const { getProposal, respondToProposal } = await import("./service");
    const id = await sentProposal({ terms: "50% up front." });
    const answer = { accept: true, name: "Pia", ip: "", today: "2026-07-01" };
    await expect(respondToProposal(database, portal, id, answer)).rejects.toThrow("accept the terms");
    await respondToProposal(database, portal, id, { ...answer, acceptTerms: true });
    expect((await getProposal(database, ctx.tenant.id, id))?.proposal.status).toBe("accepted");
  });

  it("keeps the reason a client gives for declining and tells the team", async () => {
    const { notifications } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const { getProposal, reopenProposal, respondToProposal } = await import("./service");
    const id = await sentProposal();
    await respondToProposal(database, portal, id, {
      accept: false,
      name: "Pia",
      ip: "",
      today: "2026-07-01",
      reason: "  Over budget this quarter  ",
    });
    const row = await getProposal(database, ctx.tenant.id, id);
    expect(row?.proposal).toMatchObject({ status: "declined", declineReason: "Over budget this quarter" });
    const inbox = await database.select().from(notifications).where(eq(notifications.userId, ctx.user.id));
    expect(inbox.some((n) => n.body.includes("Over budget this quarter"))).toBe(true);
    await reopenProposal(database, ctx, id);
    expect((await getProposal(database, ctx.tenant.id, id))?.proposal.declineReason).toBe("");
  });

  it("refuses an expired proposal until staff extend it", async () => {
    const { extendProposal, getProposal, listProposals, respondToProposal } = await import("./service");
    const id = await sentProposal({ validUntil: "2026-06-30" });
    const answer = { accept: true, name: "Pia", ip: "", today: "2026-07-05" };
    await expect(respondToProposal(database, portal, id, answer)).rejects.toThrow("expired");
    const expired = await listProposals(database, ctx.tenant.id, { status: "expired", today: "2026-07-05" });
    expect(expired.map((r) => r.proposal.id)).toContain(id);

    await expect(
      extendProposal(database, ctx, id, { validUntil: "2026-07-01", today: "2026-07-05" }),
    ).rejects.toThrow();
    await extendProposal(database, ctx, id, { validUntil: "2026-07-31", today: "2026-07-05" });
    await respondToProposal(database, portal, id, answer);
    expect((await getProposal(database, ctx.tenant.id, id))?.proposal.status).toBe("accepted");
    await expect(
      extendProposal(database, ctx, id, { validUntil: "2026-08-31", today: "2026-07-05" }),
    ).rejects.toThrow();
  });
});
