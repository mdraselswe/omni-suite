import "server-only";
import { and, eq, lte } from "drizzle-orm";
import { connectedTenants, fullSync, snapshot, syncChanges } from "@/features/backup";
import { runRecurring } from "@/features/invoices";
import { today } from "@/lib/dates";
import { parseTenantSettings } from "@/lib/tenant-settings";
import type { Database } from "@/server/db";
import { recurringInvoices, tenants } from "@/server/db/schema";
import { enqueue, type JobHandler } from "./queue";

function tenantOf(job: { tenantId: string | null }): string {
  if (!job.tenantId) throw new Error("Job needs a tenant");
  return job.tenantId;
}

async function loadTenant(database: Database, id: string) {
  const [row] = await database.select().from(tenants).where(eq(tenants.id, id));
  if (!row) throw new Error("Tenant not found");
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    plan: row.plan,
    settings: parseTenantSettings(row.settings),
  };
}

/** Job type → handler. */
export function createHandlers(database: () => Database): Map<string, JobHandler> {
  return new Map<string, JobHandler>([
    ["backup.sync", (job) => syncChanges(database(), tenantOf(job))],
    ["backup.full", (job) => fullSync(database(), tenantOf(job))],
    ["backup.snapshot", (job) => snapshot(database(), tenantOf(job))],
    [
      "invoices.recurring",
      async (job) => {
        const tenant = await loadTenant(database(), tenantOf(job));
        await runRecurring(database(), tenant, today(tenant.settings.timezone));
      },
    ],
  ]);
}

/** Enqueues time-based jobs (nightly snapshots, recurring invoices). Idempotent. */
export async function scheduleRecurring(database: Database, now: Date): Promise<void> {
  const dayAgo = new Date(now.getTime() - 20 * 3600_000);
  for (const c of await connectedTenants(database)) {
    if (!c.lastSnapshotAt || c.lastSnapshotAt < dayAgo) {
      await enqueue(database, {
        type: "backup.snapshot",
        tenantId: c.tenantId,
        dedupeKey: `backup.snapshot:${c.tenantId}`,
      });
    }
  }
  // Recurring invoices: any tenant with a schedule due by the latest "today" anywhere.
  const latestDay = today("Pacific/Kiritimati", now);
  const due = await database
    .selectDistinct({ tenantId: recurringInvoices.tenantId })
    .from(recurringInvoices)
    .where(and(eq(recurringInvoices.active, true), lte(recurringInvoices.nextRunDate, latestDay)));
  for (const d of due) {
    await enqueue(database, {
      type: "invoices.recurring",
      tenantId: d.tenantId,
      dedupeKey: `invoices.recurring:${d.tenantId}`,
    });
  }
}
