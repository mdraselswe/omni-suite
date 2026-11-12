import "server-only";
import { desc, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { toJsonSafe } from "@/server/audit";
import type { DbOrTx } from "@/server/db";
import * as s from "@/server/db/schema";
import { hasPermission, type TenantContext } from "@/server/tenancy/context";

/**
 * Tenant data sets for backups and exports (ADR 0007). Each has a tenant_id
 * column, so one generic query serves them all. Secrets are never exported.
 */
export const EXPORT_SETS = {
  clients: s.clients,
  leads: s.leads,
  onboarding: s.onboardingRequests,
  proposals: s.proposals,
  invoices: s.invoices,
  invoice_payments: s.invoicePayments,
  invoice_adjustments: s.invoiceAdjustments,
  bills: s.bills,
  bill_payments: s.billPayments,
  recurring_invoices: s.recurringInvoices,
  accounts: s.accounts,
  categories: s.categories,
  transactions: s.transactions,
  periods: s.periods,
  partners: s.partners,
  capital: s.capitalContributions,
  ownership_events: s.ownershipEvents,
  ownership_periods: s.ownershipPeriods,
  profit_rules: s.profitRules,
  distributions: s.distributionRuns,
  projects: s.projects,
  tasks: s.tasks,
  time_entries: s.timeEntries,
  files: s.files,
  custom_fields: s.customFieldDefs,
  audit_log: s.auditLogs,
} as const;

export type ExportSet = keyof typeof EXPORT_SETS;
export const EXPORT_SET_NAMES = Object.keys(EXPORT_SETS) as ExportSet[];

/**
 * The permission that guards each CSV set. A set holds every row of the tenant,
 * so the member needs it with "all" scope (someone limited to their own or
 * assigned rows can't download everyone's). Finance ledgers need finance.export.
 * The full JSON export needs backup.manage.
 */
export const EXPORT_PERMISSIONS: Record<ExportSet, string> = {
  clients: "clients.read",
  leads: "leads.read",
  onboarding: "onboarding.manage",
  proposals: "proposals.read",
  invoices: "invoices.read",
  invoice_payments: "finance.export",
  invoice_adjustments: "invoices.read",
  bills: "bills.read",
  bill_payments: "finance.export",
  recurring_invoices: "invoices.read",
  accounts: "finance.export",
  categories: "finance.export",
  transactions: "finance.export",
  periods: "finance.export",
  partners: "partners.read",
  capital: "partners.read",
  ownership_events: "partners.read",
  ownership_periods: "partners.read",
  profit_rules: "partners.read",
  distributions: "partners.read",
  projects: "projects.read",
  tasks: "projects.read",
  time_entries: "time.read",
  files: "files.read",
  custom_fields: "settings.manage",
  audit_log: "audit.read",
};

/** Scope a member must hold for a set's permission to download it. */
export const EXPORT_SCOPE = "all" as const;

/** Whether the member may download this CSV set. */
export function canExportSet(ctx: TenantContext, set: ExportSet): boolean {
  return hasPermission(ctx, EXPORT_PERMISSIONS[set], EXPORT_SCOPE);
}

/** The CSV sets this member may download (for the export list). */
export function exportableSets(ctx: TenantContext): ExportSet[] {
  return EXPORT_SET_NAMES.filter((set) => canExportSet(ctx, set));
}

/** Which sheet tabs an outbox entity change affects. */
export const ENTITY_SETS: Record<string, ExportSet[]> = {
  account: ["accounts"],
  category: ["categories"],
  transaction: ["transactions"],
  partner: ["partners"],
  capital: ["capital", "transactions"],
  ownership: ["ownership_events", "ownership_periods"],
  profitRule: ["profit_rules"],
  distribution: ["distributions"],
  client: ["clients"],
  lead: ["leads"],
  onboarding: ["onboarding"],
  proposal: ["proposals"],
  invoice: ["invoices", "invoice_payments", "invoice_adjustments", "transactions"],
  bill: ["bills", "bill_payments", "transactions"],
  project: ["projects"],
  task: ["tasks"],
  time: ["time_entries"],
  file: ["files"],
};

export async function exportRows(
  database: DbOrTx,
  tenantId: string,
  set: ExportSet,
): Promise<Record<string, unknown>[]> {
  const table = EXPORT_SETS[set] as PgTable & {
    tenantId: typeof s.clients.tenantId;
    createdAt?: typeof s.clients.createdAt;
  };
  let query = database.select().from(table).where(eq(table.tenantId, tenantId)).$dynamic();
  if (set === "audit_log") query = query.orderBy(desc(s.auditLogs.createdAt)).limit(20_000);
  const rows = await query;
  return toJsonSafe(rows) as Record<string, unknown>[];
}

/** Everything for one tenant, as JSON-safe data. */
export async function exportTenant(database: DbOrTx, tenantId: string) {
  const [tenant] = await database.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
  const data: Record<string, unknown[]> = {};
  for (const set of EXPORT_SET_NAMES) data[set] = await exportRows(database, tenantId, set);
  return {
    format: "omnisuite-export@1",
    exportedAt: new Date().toISOString(),
    tenant: toJsonSafe(tenant),
    data,
  };
}

/** Rows → header + string cells (objects as JSON). */
export function toTable(rows: readonly Record<string, unknown>[]): string[][] {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) =>
    v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return [keys, ...rows.map((r) => keys.map((k) => cell(r[k])))];
}

export function toCsv(table: readonly string[][]): string {
  const esc = (v: string) => {
    // Neutralise spreadsheet formulas (CSV injection); plain numbers like -12.50 stay numbers.
    const safe = /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return table.map((row) => row.map(esc).join(",")).join("\r\n");
}

/** Simple CSV parser (quotes, commas, newlines). First row is the header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
