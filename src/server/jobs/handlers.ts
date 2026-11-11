import "server-only";
import { and, eq, lte, min } from "drizzle-orm";
import { z } from "zod";
import { serverEnv } from "@/config/env";
import { connectedTenants, fullSync, snapshot, syncChanges } from "@/features/backup";
import { runRecurring } from "@/features/invoices";
import { syncXero, xeroDueForSync } from "@/features/xero";
import { today } from "@/lib/dates";
import { parseTenantSettings } from "@/lib/tenant-settings";
import type { Database } from "@/server/db";
import { recurringInvoices, tenants } from "@/server/db/schema";
import { sendMail } from "@/server/mail";
import { MAIL_JOB } from "@/server/shared";
import { loadTenant } from "@/server/tenancy/service";
import { enqueueUnlessBusy, type Job, type JobHandler } from "./queue";

const HOUR = 3600_000;

function tenantOf(job: { tenantId: string | null }): string {
  if (!job.tenantId) throw new Error("Job needs a tenant");
  return job.tenantId;
}

const mailPayload = z.object({
  to: z.string().min(1),
  subject: z.string(),
  text: z.string(),
  html: z.string().optional(),
});

/** Sends a queued email; throws on failure so the queue retries it. */
async function sendQueuedMail(job: Job): Promise<void> {
  const mail = mailPayload.parse(job.payload);
  // Same Message-ID on every attempt, so a retry after an unrecorded success can be dropped as a duplicate.
  const messageId = `<${job.id}@${new URL(serverEnv().APP_URL).hostname}>`;
  if (!(await sendMail({ ...mail, messageId }))) throw new Error("Email could not be sent");
}

/** Job type → handler. */
export function createHandlers(database: () => Database): Map<string, JobHandler> {
  return new Map<string, JobHandler>([
    [MAIL_JOB, sendQueuedMail],
    ["backup.sync", (job) => syncChanges(database(), tenantOf(job))],
    ["backup.full", (job) => fullSync(database(), tenantOf(job))],
    ["backup.snapshot", (job) => snapshot(database(), tenantOf(job))],
    [
      "xero.sync",
      async (job) => {
        await syncXero(database(), tenantOf(job));
      },
    ],
    [
      "invoices.recurring",
      async (job) => {
        const tenant = await loadTenant(database(), tenantOf(job));
        await runRecurring(database(), tenant, today(tenant.settings.timezone));
      },
    ],
  ]);
}

/**
 * Tenants with an active recurring invoice due today in their own time zone.
 * The SQL pre-filter uses the latest calendar day on Earth (UTC+14); the exact
 * check uses each tenant's time zone, so nothing is queued before it is due.
 */
export async function recurringDueTenants(database: Database, now: Date): Promise<string[]> {
  const latestDay = today("Pacific/Kiritimati", now);
  const rows = await database
    .select({
      tenantId: recurringInvoices.tenantId,
      next: min(recurringInvoices.nextRunDate),
      settings: tenants.settings,
    })
    .from(recurringInvoices)
    .innerJoin(tenants, eq(tenants.id, recurringInvoices.tenantId))
    .where(and(eq(recurringInvoices.active, true), lte(recurringInvoices.nextRunDate, latestDay)))
    .groupBy(recurringInvoices.tenantId, tenants.id);
  return rows
    .filter((r) => r.next !== null && r.next <= today(parseTenantSettings(r.settings).timezone, now))
    .map((r) => r.tenantId);
}

/**
 * Enqueues time-based jobs (nightly snapshots, Xero, recurring invoices). Idempotent:
 * nothing is queued while the same job is pending or running, and a job that gave
 * up is not retried until its cool-down has passed (the error stays on the job row
 * and on the connection's last_error).
 */
export async function scheduleRecurring(database: Database, now: Date): Promise<void> {
  const dayAgo = new Date(now.getTime() - 20 * HOUR);
  for (const c of await connectedTenants(database)) {
    if (!c.lastSnapshotAt || c.lastSnapshotAt < dayAgo) {
      await enqueueUnlessBusy(
        database,
        { type: "backup.snapshot", tenantId: c.tenantId, dedupeKey: `backup.snapshot:${c.tenantId}` },
        { failureCooldownMs: 6 * HOUR, now },
      );
    }
  }
  // Xero: push changes at most hourly per business.
  for (const tenantId of await xeroDueForSync(database, now)) {
    await enqueueUnlessBusy(
      database,
      { type: "xero.sync", tenantId, dedupeKey: `xero.sync:${tenantId}` },
      { failureCooldownMs: HOUR, now },
    );
  }
  for (const tenantId of await recurringDueTenants(database, now)) {
    await enqueueUnlessBusy(
      database,
      { type: "invoices.recurring", tenantId, dedupeKey: `invoices.recurring:${tenantId}` },
      { failureCooldownMs: HOUR, now },
    );
  }
}
