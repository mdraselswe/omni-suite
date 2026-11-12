// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";

const sendMail = vi.fn<(message: object) => Promise<boolean>>(async () => true);
vi.mock("@/server/mail", () => ({
  sendMail: (message: object) => sendMail(message),
  appUrl: (p: string) => `https://app.test${p}`,
}));

let database: Database;
let tenantId: string;
let ownerId: string;

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ tenantId, ownerId } = await setupTenant(database, "jobs"));
  // Load the modules here (long hook timeout) so a cold import can't time out the first test.
  await Promise.all([
    import("./queue"),
    import("./handlers"),
    import("@/server/shared"),
    import("@/server/audit"),
  ]);
});

beforeEach(async () => {
  const { jobs } = await import("@/server/db/schema");
  await database.delete(jobs);
  sendMail.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function jobRows(type?: string) {
  const { jobs } = await import("@/server/db/schema");
  return type ? database.select().from(jobs).where(eq(jobs.type, type)) : database.select().from(jobs);
}

describe("stale job recovery", () => {
  it("requeues crashed jobs, but fails them when a pending duplicate exists or attempts are used up", async () => {
    const { recoverStaleJobs } = await import("./queue");
    const { jobs } = await import("@/server/db/schema");
    const stale = { status: "running" as const, lockedAt: minutesAgo(20), attempts: 1 };
    await database.insert(jobs).values([
      { type: "t.a", dedupeKey: "rec:a", ...stale },
      { type: "t.b", dedupeKey: "rec:b", ...stale },
      { type: "t.b", dedupeKey: "rec:b", status: "pending" },
      { type: "t.c", ...stale, attempts: 5 },
      { type: "t.d", status: "running", lockedAt: new Date(), attempts: 1 },
    ]);

    await recoverStaleJobs(database);

    const byType = async (type: string) => (await jobRows(type)).map((j) => j.status).sort();
    expect(await byType("t.a")).toEqual(["pending"]);
    expect(await byType("t.b")).toEqual(["failed", "pending"]);
    expect(await byType("t.c")).toEqual(["failed"]);
    expect(await byType("t.d")).toEqual(["running"]);
    const [exhausted] = await jobRows("t.c");
    expect(exhausted?.lastError).toContain("5 attempts");
  });

  it("keeps a long-running job's lock fresh so it is never recovered while it runs", async () => {
    const { enqueue, runOneJob } = await import("./queue");
    const { jobs } = await import("@/server/db/schema");
    await enqueue(database, { type: "t.slow" });
    let lockedAt: Date | null = null;
    const old = minutesAgo(30);
    const handlers = new Map([
      [
        "t.slow",
        async () => {
          await database.update(jobs).set({ lockedAt: old }).where(eq(jobs.type, "t.slow"));
          await new Promise((resolve) => setTimeout(resolve, 150));
          const rows = await database.select({ lockedAt: jobs.lockedAt }).from(jobs);
          lockedAt = rows[0]?.lockedAt ?? null;
        },
      ],
    ]);
    await runOneJob(database, handlers, { heartbeatMs: 20 });
    expect(lockedAt).not.toBeNull();
    expect((lockedAt ?? old).getTime()).toBeGreaterThan(old.getTime());
    expect((await jobRows("t.slow"))[0]?.status).toBe("done");
  });

  it("enqueueUnlessBusy skips while a job is pending or running and during the failure cool-down", async () => {
    const { enqueueUnlessBusy } = await import("./queue");
    const { jobs } = await import("@/server/db/schema");
    const job = { type: "t.sched", dedupeKey: "sched:1" };
    const opts = { failureCooldownMs: 3600_000 };
    expect(await enqueueUnlessBusy(database, job, opts)).toBe(true);
    expect(await enqueueUnlessBusy(database, job, opts)).toBe(false);
    await database.update(jobs).set({ status: "running" }).where(eq(jobs.dedupeKey, "sched:1"));
    expect(await enqueueUnlessBusy(database, job, opts)).toBe(false);
    await database
      .update(jobs)
      .set({ status: "failed", runAt: minutesAgo(10) })
      .where(eq(jobs.dedupeKey, "sched:1"));
    expect(await enqueueUnlessBusy(database, job, opts)).toBe(false);
    await database
      .update(jobs)
      .set({ runAt: minutesAgo(61) })
      .where(eq(jobs.dedupeKey, "sched:1"));
    expect(await enqueueUnlessBusy(database, job, opts)).toBe(true);
    expect(await jobRows("t.sched")).toHaveLength(2);
  });
});

describe("queued mail", () => {
  it("is queued with the transaction, never sent when it rolls back, and links become absolute", async () => {
    const { notify, MAIL_JOB } = await import("@/server/shared");
    await expect(
      database.transaction(async (tx) => {
        await notify(tx, tenantId, [ownerId], { title: "Rolled back", link: "/jobs/x", email: true });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await jobRows(MAIL_JOB)).toHaveLength(0);

    await database.transaction(async (tx) => {
      await notify(tx, tenantId, [ownerId], {
        title: "Invoice sent",
        body: "Have a look.",
        link: "/jobs/invoices/1",
        email: true,
      });
    });
    const [job] = await jobRows(MAIL_JOB);
    // Business mail goes out under the business's name.
    expect(job?.payload).toEqual({
      to: "owner@jobs.test",
      subject: "Invoice sent",
      text: "Have a look.\n\nhttps://app.test/jobs/invoices/1",
      fromName: "Biz jobs",
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("queueMail rewrites relative links in text and HTML", async () => {
    const { queueMail, MAIL_JOB } = await import("@/server/shared");
    await queueMail(database, {
      to: "a@example.com",
      subject: "Hi",
      text: "Open it:\n/jobs/projects/2\nor and/or /not-a-whole-line",
      html: '<a href="/jobs/projects/2">Open</a> <a href="https://x.test/">x</a>',
    });
    const [job] = await jobRows(MAIL_JOB);
    expect(job?.payload).toEqual({
      to: "a@example.com",
      subject: "Hi",
      text: "Open it:\nhttps://app.test/jobs/projects/2\nor and/or /not-a-whole-line",
      html: '<a href="https://app.test/jobs/projects/2">Open</a> <a href="https://x.test/">x</a>',
    });
  });

  it("sends through the worker with a stable Message-ID and retries when SMTP fails", async () => {
    const { queueMail, MAIL_JOB } = await import("@/server/shared");
    const { createHandlers } = await import("./handlers");
    const { runOneJob } = await import("./queue");
    const handlers = createHandlers(() => database);
    await queueMail(database, { to: "b@example.com", subject: "S", text: "T" });

    sendMail.mockResolvedValueOnce(false);
    await runOneJob(database, handlers);
    const [retry] = await jobRows(MAIL_JOB);
    expect(retry?.status).toBe("pending");
    expect(retry?.lastError).toContain("could not be sent");

    const { jobs } = await import("@/server/db/schema");
    await database.update(jobs).set({ runAt: new Date() }).where(eq(jobs.type, MAIL_JOB));
    await runOneJob(database, handlers);
    expect((await jobRows(MAIL_JOB))[0]?.status).toBe("done");
    expect(sendMail).toHaveBeenCalledTimes(2);
    const ids = sendMail.mock.calls.map(([m]) => (m as { messageId?: string }).messageId);
    expect(ids[0]).toMatch(/^<.+@.+>$/);
    expect(ids[1]).toBe(ids[0]);
  });
});

describe("scheduler", () => {
  it("queues recurring invoices only once they are due in the tenant's own time zone", async () => {
    const { recurringDueTenants, scheduleRecurring } = await import("./handlers");
    const { clients, jobs, recurringInvoices, tenants } = await import("@/server/db/schema");
    const { parseTenantSettings } = await import("@/lib/tenant-settings");
    const [tenant] = await database.select().from(tenants).where(eq(tenants.id, tenantId));
    await database
      .update(tenants)
      .set({ settings: { ...parseTenantSettings(tenant?.settings), timezone: "America/Los_Angeles" } })
      .where(eq(tenants.id, tenantId));
    const [client] = await database
      .insert(clients)
      .values({ tenantId, name: "Due Co" })
      .returning({ id: clients.id });
    await database.insert(recurringInvoices).values({
      tenantId,
      clientId: client?.id ?? "",
      name: "Retainer",
      nextRunDate: "2026-11-11",
      currency: "AUD",
    });

    // 05:00 UTC: already the 11th in Kiritimati, still the 10th in Los Angeles.
    const early = new Date("2026-11-11T05:00:00Z");
    expect(await recurringDueTenants(database, early)).not.toContain(tenantId);
    await scheduleRecurring(database, early);
    expect(await jobRows("invoices.recurring")).toHaveLength(0);

    const due = new Date("2026-11-11T09:00:00Z");
    expect(await recurringDueTenants(database, due)).toContain(tenantId);
    await scheduleRecurring(database, due);
    await scheduleRecurring(database, due);
    expect(await jobRows("invoices.recurring")).toHaveLength(1);

    // After it gives up, the next minutes don't queue it again (cool-down).
    await database
      .update(jobs)
      .set({ status: "failed", runAt: due })
      .where(eq(jobs.type, "invoices.recurring"));
    await scheduleRecurring(database, new Date(due.getTime() + 60_000));
    expect(await jobRows("invoices.recurring")).toHaveLength(1);
  });
});

describe("backup outbox", () => {
  it("skips tenants without Google and delays one shared sync job so bursts coalesce", async () => {
    const { markChanged, BACKUP_SYNC_DELAY_MS } = await import("@/server/audit");
    const { googleConnections, syncOutbox } = await import("@/server/db/schema");
    const outbox = () => database.select().from(syncOutbox).where(eq(syncOutbox.tenantId, tenantId));

    await markChanged(database, tenantId, "client", "01890000-0000-7000-8000-0000000000aa");
    expect(await outbox()).toHaveLength(0);
    expect(await jobRows("backup.sync")).toHaveLength(0);

    await database.insert(googleConnections).values({ tenantId, refreshTokenEnc: "enc" });
    const before = Date.now();
    await database.transaction(async (tx) => {
      await markChanged(tx, tenantId, "client", "01890000-0000-7000-8000-0000000000aa");
      await markChanged(tx, tenantId, "invoice", "01890000-0000-7000-8000-0000000000bb");
    });
    expect(await outbox()).toHaveLength(2);
    const sync = await jobRows("backup.sync");
    expect(sync).toHaveLength(1);
    expect(sync[0]?.runAt.getTime()).toBeGreaterThanOrEqual(before + BACKUP_SYNC_DELAY_MS - 1000);
    await database.delete(googleConnections).where(and(eq(googleConnections.tenantId, tenantId)));
  });
});

describe("business mail", () => {
  it("uses the business's display name and reply-to address", async () => {
    const { queueMail, MAIL_JOB } = await import("@/server/shared");
    const { tenants } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await database.select().from(tenants).where(eq(tenants.id, tenantId));
    const settings = {
      ...(row?.settings as object),
      replyToEmail: "accounts@biz.test",
      branding: { displayName: "Biz Studio" },
    };
    await database.update(tenants).set({ settings }).where(eq(tenants.id, tenantId));
    await queueMail(database, { to: "c@example.com", subject: "Hi", text: "Hello" }, { tenantId });
    const [job] = await jobRows(MAIL_JOB);
    expect(job?.payload).toMatchObject({ fromName: "Biz Studio", replyTo: "accounts@biz.test" });
    await database.update(tenants).set({ settings: row?.settings }).where(eq(tenants.id, tenantId));
  });
});
