// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";
import { parsePage } from "@/lib/pagination";
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
    await sendOnboarding(database, ctx, { clientId, templateId: used.id, inviteEmail: "acme@example.com" });
    await expect(deleteTemplate(database, ctx, used.id)).rejects.toThrow();
    await deleteTemplate(database, ctx, spare.id);
    const left = (await listTemplates(database, ctx.tenant.id)).map((x) => x.name);
    expect(left).toContain("Used");
    expect(left).not.toContain("Spare");
  });
});

describe("onboarding question types", () => {
  it("reads old text-only templates and parses select and file questions", async () => {
    const { parseQuestionLines, parseTemplateFields, questionLines } = await import("./service");
    expect(
      parseTemplateFields([
        { key: "goals", label: "Goals", type: "textarea", required: true },
        { key: "name", label: "Name", type: "text" },
        { key: "odd", label: "Odd", type: "date" },
        { key: "empty", label: "Empty", type: "select", options: [] },
      ]),
    ).toEqual([
      { key: "goals", label: "Goals", type: "textarea", required: true, options: [] },
      { key: "name", label: "Name", type: "text", required: false, options: [] },
      { key: "odd", label: "Odd", type: "text", required: false, options: [] },
      { key: "empty", label: "Empty", type: "text", required: false, options: [] },
    ]);
    const lines = [
      "Budget | select: Small, Medium , Small, Large | required",
      "Logo | file",
      "Notes | textarea",
      "Company",
    ].join("\n");
    const fields = parseQuestionLines(lines);
    expect(fields).toEqual([
      {
        key: "budget",
        label: "Budget",
        type: "select",
        required: true,
        options: ["Small", "Medium", "Large"],
      },
      { key: "logo", label: "Logo", type: "file", required: false, options: [] },
      { key: "notes", label: "Notes", type: "textarea", required: false, options: [] },
      { key: "company", label: "Company", type: "text", required: false, options: [] },
    ]);
    expect(parseQuestionLines(questionLines(fields))).toEqual(fields);
    expect(() => parseQuestionLines("Budget | select")).toThrow(/choices/);
  });

  it("checks choices and files when the client answers", async () => {
    const { addMember } = await import("@/server/testing/db");
    const { files } = await import("@/server/db/schema");
    const {
      createClient,
      listTemplates,
      onboardingForClient,
      saveTemplate,
      sendOnboarding,
      submitOnboarding,
    } = await import("./service");
    const clientId = await createClient(database, ctx, {
      name: "Answers Ltd",
      email: "",
      phone: "",
      website: "",
      address: "",
      notes: "",
      status: "active",
      custom: {},
    });
    const other = await createClient(database, ctx, {
      name: "Other Ltd",
      email: "",
      phone: "",
      website: "",
      address: "",
      notes: "",
      status: "active",
      custom: {},
    });
    await saveTemplate(database, ctx, {
      id: null,
      name: "Kickoff",
      fields: [
        { key: "budget", label: "Budget", type: "select", required: true, options: ["Small", "Large"] },
        { key: "logo", label: "Logo", type: "file", required: true, options: [] },
        { key: "goals", label: "Goals", type: "textarea", required: false, options: [] },
      ],
      checklist: [],
    });
    const template = (await listTemplates(database, ctx.tenant.id)).find((x) => x.name === "Kickoff");
    if (!template) throw new Error("template missing");
    const { ctx: portal } = await addMember(database, "cli", "client_owner", "Ana Answers", {
      kind: "client",
      clientId,
    });
    const { id, delivery } = await sendOnboarding(database, ctx, { clientId, templateId: template.id });
    expect(delivery).toBe("portal");

    const file = async (entityId: string, clientVisible: boolean) => {
      const [row] = await database
        .insert(files)
        .values({
          tenantId: ctx.tenant.id,
          entityType: "client",
          entityId,
          name: "logo.png",
          mime: "image/png",
          size: 10,
          storageKey: `k-${entityId}-${String(clientVisible)}`,
          clientVisible,
        })
        .returning({ id: files.id });
      if (!row) throw new Error("file insert failed");
      return row.id;
    };
    const mine = await file(clientId, true);
    const hidden = await file(clientId, false);
    const theirs = await file(other, true);

    await expect(submitOnboarding(database, portal, id, { budget: "Huge", logo: mine })).rejects.toThrow(
      /listed/,
    );
    await expect(submitOnboarding(database, portal, id, { budget: "Small", logo: [] })).rejects.toThrow(
      /Logo/,
    );
    await expect(submitOnboarding(database, portal, id, { budget: "Small", logo: theirs })).rejects.toThrow(
      /no longer available/,
    );
    await expect(submitOnboarding(database, portal, id, { budget: "Small", logo: hidden })).rejects.toThrow(
      /no longer available/,
    );
    await submitOnboarding(database, portal, id, { budget: "Small", logo: [mine, mine], goals: "Grow" });
    const [answered] = await onboardingForClient(database, ctx.tenant.id, clientId);
    expect(answered?.status).toBe("submitted");
    expect(answered?.answers).toEqual({ budget: "Small", logo: [mine], goals: "Grow" });
  });
});

describe("sending onboarding to a client nobody can reach", () => {
  it("refuses, invites the first portal user, or waits for a pending invitation", async () => {
    const { invitations } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const { createClient, listTemplates, onboardingReach, saveTemplate, sendOnboarding } =
      await import("./service");
    const clientId = await createClient(database, ctx, {
      name: "Silent Co",
      email: "boss@silent.test",
      phone: "",
      website: "",
      address: "",
      notes: "",
      status: "active",
      custom: {},
    });
    await saveTemplate(database, ctx, { id: null, name: "Intro", fields: [], checklist: [] });
    const template = (await listTemplates(database, ctx.tenant.id)).find((x) => x.name === "Intro");
    if (!template) throw new Error("template missing");

    await expect(sendOnboarding(database, ctx, { clientId, templateId: template.id })).rejects.toThrow(
      /No one from Silent Co/,
    );
    const invited = await sendOnboarding(database, ctx, {
      clientId,
      templateId: template.id,
      inviteEmail: "boss@silent.test",
    });
    expect(invited.delivery).toBe("invited");
    const [invite] = await database
      .select()
      .from(invitations)
      .where(eq(invitations.email, "boss@silent.test"));
    expect(invite?.clientId).toBe(clientId);
    expect(invite?.kind).toBe("client");
    expect(await onboardingReach(database, ctx.tenant.id, clientId)).toEqual({
      canAnswer: 0,
      portalUsers: 0,
      pendingInvites: 1,
    });
    // The invitation is still pending: the next form waits for it instead of failing.
    const waiting = await sendOnboarding(database, ctx, { clientId, templateId: template.id });
    expect(waiting.delivery).toBe("pendingInvite");
  });
});

describe("client list pages and search", () => {
  it("pages by name with a stable order and searches name, email and phone", async () => {
    const { createClient, pageClients } = await import("./service");
    const { setupTenant } = await import("@/server/testing/db");
    const { ctx: own } = await setupTenant(database, "cli-pages");
    const base = { email: "", phone: "", website: "", address: "", notes: "", custom: {} };
    const names = ["Delta", "Alpha", "Charlie", "Bravo", "Echo"];
    for (const name of names) {
      await createClient(database, own, { ...base, name, status: "active" });
    }
    await createClient(database, own, {
      ...base,
      name: "Foxtrot",
      email: "hello@fox.test",
      phone: "0400 123 456",
      status: "inactive",
    });
    const size2 = (page: number) => parsePage({ page: String(page), size: "2" }, { sizes: [2] });
    const pages = await Promise.all([1, 2, 3].map((p) => pageClients(database, own, "all", {}, size2(p))));
    expect(pages.map((p) => p.total)).toEqual([6, 6, 6]);
    const seen = pages.flatMap((p) => p.rows.map((c) => c.name));
    expect(seen).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);

    const find = async (q: string, status?: "active" | "inactive") =>
      (await pageClients(database, own, "all", { q, status }, parsePage({}))).rows.map((c) => c.name);
    expect(await find("FOX.TEST")).toEqual(["Foxtrot"]);
    expect(await find("123 456")).toEqual(["Foxtrot"]);
    expect(await find("echo")).toEqual(["Echo"]);
    expect(await find("fox", "active")).toEqual([]);
    expect(await find("%")).toEqual([]);
    expect((await pageClients(database, ctx, "all", { q: "foxtrot" }, parsePage({}))).total).toBe(0);
  });
});
