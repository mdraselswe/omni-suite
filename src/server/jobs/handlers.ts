import "server-only";
import { and, eq, inArray, lte, min } from "drizzle-orm";
import { z } from "zod";
import { serverEnv } from "@/config/env";
import { connectedTenants, fullSync, snapshot, syncChanges } from "@/features/backup";
import { runRecurring, runReminders } from "@/features/invoices";
import { syncXero, xeroDueForSync } from "@/features/xero";
import { today } from "@/lib/dates";
import { parseTenantSettings } from "@/lib/tenant-settings";
import type { Database } from "@/server/db";
import { invoices, recurringInvoices, tenants } from "@/server/db/schema";
import { sendMail } from "@/server/mail";
import { MAIL_JOB } from "@/server/shared";
import { loadTenant } from "@/server/tenancy/service";
import { enqueueUnlessBusy, type Job, type JobHandler } from "./queue";

const HOUR = 3600_000;

function tenantOf(job: { tenantId: string | null }): string {
  if (!job.tenantId) throw new Error("Job needs a tenant");
  return job.tenantId;
}

/** True when the business exists and isn't suspended. */
export async function tenantIsActive(database: Database, tenantId: string): Promise<boolean> {
  const [row] = await database
    .select({ status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return row?.status === "active";
}

/**
 * Tenant work (syncs, recurring invoices) only runs for active businesses: a job
 * queued before the business was suspended finishes as a no-op instead.
 */
function forActiveTenant(database: () => Database, run: (tenantId: string) => Promise<unknown>): JobHandler {
  return async (job) => {
    const tenantId = tenantOf(job);
    if (!(await tenantIsActive(database(), tenantId))) return;
    await run(tenantId);
  };
}

const mailPayload = z.object({
  to: z.string().min(1),
  subject: z.string(),
  text: z.string(),
  html: z.string().optional(),
  replyTo: z.email().optional(),
  fromName: z.string().max(80).optional(),
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
    ["backup.sync", forActiveTenant(database, (id) => syncChanges(database(), id))],
    ["backup.full", forActiveTenant(database, (id) => fullSync(database(), id))],
    ["backup.snapshot", forActiveTenant(database, (id) => snapshot(database(), id))],
    ["xero.sync", forActiveTenant(database, (id) => syncXero(database(), id))],
    [
      "invoices.recurring",
      forActiveTenant(database, async (id) => {
        const tenant = await loadTenant(database(), id);
        await runRecurring(database(), tenant, today(tenant.settings.timezone));
      }),
    ],
    [
      "invoices.reminders",
      forActiveTenant(database, async (id) => {
        const tenant = await loadTenant(database(), id);
        await runReminders(database(), tenant, today(tenant.settings.timezone));
      }),
    ],
  ]);
}

/**
 * Tenants with a payment reminder due today in their own time zone (same
 * pre-filter as recurring invoices: the latest calendar day on Earth first).
 */
export async function reminderDueTenants(database: Database, now: Date): Promise<string[]> {
  const latestDay = today("Pacific/Kiritimati", now);
  const rows = await database
    .select({ tenantId: invoices.tenantId, next: min(invoices.nextReminderOn), settings: tenants.settings })
    .from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .where(
      and(
        inArray(invoices.status, ["sent", "partially_paid"]),
        lte(invoices.nextReminderOn, latestDay),
        eq(tenants.status, "active"),
      ),
    )
    .groupBy(invoices.tenantId, tenants.id);
  return rows
    .filter((r) => r.next !== null && r.next <= today(parseTenantSettings(r.settings).timezone, now))
    .map((r) => r.tenantId);
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
    .where(
      and(
        eq(recurringInvoices.active, true),
        lte(recurringInvoices.nextRunDate, latestDay),
        // Suspended businesses don't bill.
        eq(tenants.status, "active"),
      ),
    )
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
  for (const tenantId of await reminderDueTenants(database, now)) {
    await enqueueUnlessBusy(
      database,
      { type: "invoices.reminders", tenantId, dedupeKey: `invoices.reminders:${tenantId}` },
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
