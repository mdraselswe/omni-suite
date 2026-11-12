// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));
// Keep uploads off the disk: the service only needs a key back.
vi.mock("@/server/storage", () => ({
  storeFile: vi.fn(async (tenantId: string) => `${tenantId}/${crypto.randomUUID()}`),
  removeFile: vi.fn(async () => undefined),
  loadFile: vi.fn(async () => Buffer.from("")),
}));

let database: Database;
let ctx: TenantContext;
let ownerId: string;
let staff: TenantContext;
let portal: TenantContext;
let acme: string;
let other: string;
let onProject: string;
let offProject: string;
let otherClientProject: string;

const file = (name = "brief.pdf") => new File(["hello"], name, { type: "application/pdf" });

beforeAll(async () => {
  const { createTestDb, setupTenant, addMember } = await import("@/server/testing/db");
  const { createClient } = await import("@/features/clients");
  const { createProject, setProjectMember } = await import("@/features/projects");
  database = await createTestDb();
  ({ ctx, ownerId } = await setupTenant(database, "fls"));
  const client = (name: string) =>
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
  acme = await client("Acme");
  other = await client("Other Co");
  const project = (name: string, clientId: string) =>
    createProject(database, ctx, {
      name,
      description: "",
      clientId,
      status: "active",
      startDate: null,
      dueDate: null,
      budgetMinor: 0n,
      custom: {},
      templateId: null,
    });
  onProject = await project("Acme site", acme);
  offProject = await project("Acme app", acme);
  otherClientProject = await project("Other site", other);
  const s = await addMember(database, "fls", "staff", "Sam Staff");
  staff = s.ctx;
  await setProjectMember(database, ctx, { projectId: onProject, membershipId: s.membershipId, add: true });
  ({ ctx: portal } = await addMember(database, "fls", "client_owner", "Cara Client", {
    kind: "client",
    clientId: acme,
  }));
});

describe("file uploads", () => {
  it("keeps assigned-scope staff to projects and clients they work on", async () => {
    const { uploadFile } = await import("./service");
    expect(staff.permissions.get("files.write")).toBe("assigned");
    const up = (entityType: "project" | "client", entityId: string) =>
      uploadFile(database, staff, { file: file(), entityType, entityId, clientVisible: true });
    await expect(up("project", offProject)).rejects.toThrow();
    await expect(up("project", otherClientProject)).rejects.toThrow();
    await expect(up("client", other)).rejects.toThrow();
    expect(await up("project", onProject)).toBeTruthy();
    // The client of a project they are on is in reach too.
    expect(await up("client", acme)).toBeTruthy();
  });

  it("never shares general files with clients and checks ledger targets", async () => {
    const { files } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const { uploadFile } = await import("./service");
    const id = await uploadFile(database, staff, {
      file: file("notes.txt"),
      entityType: "general",
      entityId: null,
      clientVisible: true,
    });
    const [row] = await database.select().from(files).where(eq(files.id, id));
    expect(row?.clientVisible).toBe(false);
    await expect(
      uploadFile(database, ctx, {
        file: file(),
        entityType: "transaction",
        entityId: crypto.randomUUID(),
        clientVisible: false,
      }),
    ).rejects.toThrow();
  });

  it("keeps ledger receipts from people who can't read the ledger", async () => {
    const { addMember } = await import("@/server/testing/db");
    const { createAccount, createTransaction } = await import("@/features/finance");
    const { fileForDownload, listFiles, uploadFile } = await import("./service");
    const account = await createAccount(database, ctx, {
      name: "Receipts bank",
      type: "bank",
      currency: ctx.tenant.settings.currency,
      openingBalanceMinor: 0n,
    });
    const txn = await createTransaction(database, ctx, {
      kind: "expense",
      accountId: account,
      date: "2026-07-01",
      description: "Printer ink",
      amountMinor: 4_500n,
    });
    const id = await uploadFile(database, ctx, {
      file: file("receipt.pdf"),
      entityType: "transaction",
      entityId: txn,
      clientVisible: false,
    });
    // A manager sees every file, but no money: the receipt stays hidden.
    const { ctx: manager } = await addMember(database, "fls", "manager", "Mo Manager");
    expect(manager.permissions.get("files.read")).toBe("all");
    expect(manager.permissions.has("finance.read")).toBe(false);
    expect((await listFiles(database, manager, "all")).map((r) => r.file.id)).not.toContain(id);
    expect(await fileForDownload(database, manager, "all", id)).toBeFalsy();
    expect((await listFiles(database, ctx, "all")).map((r) => r.file.id)).toContain(id);
  });

  it("lets a client upload only to their own client and projects, shares it and tells the team", async () => {
    const { files, notifications } = await import("@/server/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const { listFiles, uploadFile } = await import("./service");
    const up = (entityType: "project" | "client" | "general", entityId: string | null) =>
      uploadFile(database, portal, { file: file("logo.png"), entityType, entityId, clientVisible: false });
    await expect(up("project", otherClientProject)).rejects.toThrow();
    await expect(up("client", other)).rejects.toThrow();
    await expect(up("general", null)).rejects.toThrow();

    const id = await up("project", offProject);
    const [row] = await database.select().from(files).where(eq(files.id, id));
    expect(row?.clientVisible).toBe(true);
    expect((await listFiles(database, portal, "all")).map((r) => r.file.id)).toContain(id);

    const owned = await database
      .select()
      .from(notifications)
      .where(and(eq(notifications.tenantId, ctx.tenant.id), eq(notifications.userId, ownerId)));
    const note = owned.find((n) => n.title.includes("logo.png"));
    expect(note?.link).toBe(`/fls/projects/${offProject}`);
    // The uploader is not notified about their own file.
    const self = await database.select().from(notifications).where(eq(notifications.userId, portal.user.id));
    expect(self.some((n) => n.title.includes("logo.png"))).toBe(false);
  });

  it("hides team-only files from the portal and pages the list", async () => {
    const { listFiles, uploadFile } = await import("./service");
    const hidden = await uploadFile(database, ctx, {
      file: file("internal.pdf"),
      entityType: "project",
      entityId: onProject,
      clientVisible: false,
    });
    const portalIds = (await listFiles(database, portal, "all")).map((r) => r.file.id);
    expect(portalIds).not.toContain(hidden);
    expect(await listFiles(database, ctx, "all", { limit: 2 })).toHaveLength(2);
  });
});

describe("storage quota", () => {
  it("refuses an upload that would take the business over its quota", async () => {
    const { storageQuota, storageUsed, uploadFile } = await import("./service");
    const { files } = await import("@/server/db/schema");
    const before = await storageUsed(database, ctx.tenant.id);
    // Fill the quota up to the last 2 bytes with rows (an integer column holds < 2 GB each).
    let left = storageQuota() - before - 2;
    while (left > 0) {
      const size = Math.min(left, 2_000_000_000);
      await database.insert(files).values({
        tenantId: ctx.tenant.id,
        entityType: "general",
        name: "big.bin",
        mime: "application/octet-stream",
        size,
        storageKey: `${ctx.tenant.id}/${crypto.randomUUID()}`,
        uploadedBy: ownerId,
      });
      left -= size;
    }
    const upload = () =>
      uploadFile(database, ctx, {
        file: file(),
        entityType: "general",
        entityId: null,
        clientVisible: false,
      });
    await expect(upload()).rejects.toThrow(/file storage/);
    expect(await storageUsed(database, ctx.tenant.id)).toBe(storageQuota() - 2);
  });
});
