import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { limits } from "@/config";
import { t, type MessageKey } from "@/i18n";
import {
  cellOf,
  countRows,
  matchColumns,
  normaliseText,
  parseImportDate,
  rowStatus,
  type DateFormat,
  type ImportCounts,
  type ImportPreview,
  type ImportRowView,
} from "@/lib/csv-import";
import { customFieldName, parseCustomFields } from "@/lib/custom-fields";
import { formatMoney, parseMoney } from "@/lib/money";
import { UserError } from "@/server/action";
import { audit } from "@/server/audit";
import type { Database, DbOrTx } from "@/server/db";
import { leads, memberships, user } from "@/server/db/schema";
import { parseCsv } from "@/server/export";
import { customFieldsFor } from "@/server/shared";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { createLead, type LeadInput } from "./service";

/**
 * Lead CSV import. Columns are found by name (first match wins, case, spaces and
 * punctuation ignored), so exports from spreadsheets and other CRMs work as they are.
 * Custom fields come from `cf_<key>` columns, as in the client import.
 */
export const LEAD_COLUMNS = {
  name: ["name", "full name", "contact name", "contact", "lead name", "lead"],
  company: ["company", "company name", "organisation", "organization", "business", "account"],
  email: ["email", "email address", "e-mail", "contact email"],
  phone: ["phone", "phone number", "mobile", "telephone", "tel", "contact phone"],
  source: ["source", "lead source", "channel"],
  stage: ["stage", "pipeline stage", "deal stage", "status", "lead status"],
  value: ["value", "estimated value", "deal value", "amount", "budget"],
  followUpDate: [
    "follow up date",
    "follow up",
    "follow-up",
    "next follow up",
    "next action date",
    "due date",
  ],
  notes: ["notes", "note", "comments", "description"],
  owner: ["owner email", "owner", "assigned to", "assignee", "lead owner"],
} as const;

type LeadColumn = keyof typeof LEAD_COLUMNS;

const COLUMN_LABEL: Record<LeadColumn, MessageKey> = {
  name: "form.name",
  company: "leads.company",
  email: "form.email.label",
  phone: "form.phone",
  source: "leads.source",
  stage: "leads.stage",
  value: "leads.value",
  followUpDate: "leads.followUp",
  notes: "form.notes",
  owner: "imports.leads.ownerEmail",
};

/** Longest value each text column may hold (as in the lead form). */
const MAX_LENGTH: Partial<Record<LeadColumn, number>> = {
  name: 200,
  company: 200,
  phone: 50,
  source: 100,
  notes: 5000,
};

/** The sample file offered in the dialog: header plus two rows. */
export const LEAD_SAMPLE: readonly (readonly string[])[] = [
  ["name", "company", "email", "phone", "source", "stage", "value", "follow up date", "notes", "owner email"],
  [
    "Jane Citizen",
    "Citizen Bakery",
    "jane@example.com",
    "0400 000 000",
    "Website",
    "New enquiry",
    "2,500.00",
    "2026-12-01",
    "Wants a new menu site",
    "",
  ],
  ["Sam Lee", "Lee & Co", "", "", "Referral", "call", "1200", "15/12/2026", "Call after the holidays", ""],
];

export type PlannedLead = ImportRowView & { lead: LeadInput | null };

export type LeadImportPlan = {
  rows: PlannedLead[];
  columns: { field: string; header: string }[];
  ignored: string[];
};

/** The CSV rows of an uploaded file (first row is the header), refusing empty and oversized files. */
export async function readImportRows(formData: FormData): Promise<Record<string, string>[]> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UserError(t("files.empty"));
  const rows = parseCsv(await file.text());
  if (rows.length === 0) throw new UserError(t("imports.noRows"));
  if (rows.length > limits.imports.maxRows)
    throw new UserError(t("imports.tooMany", { count: rows.length, max: limits.imports.maxRows }));
  return rows;
}

const isEmail = (value: string) => z.email().safeParse(value).success;

/** Duplicate keys of a lead: its email, or its name + company when it has no email. */
function leadKey(email: string, name: string, company: string): string {
  return email ? `e:${normaliseText(email)}` : `n:${normaliseText(name)}|${normaliseText(company)}`;
}

/**
 * Checks every row without writing anything: the preview and the import share it.
 * Duplicates are leads already in the business (any owner, archived too) with the
 * same email, or the same name and company when the row has no email, and repeats
 * of an earlier row in the file.
 */
export async function planLeadImport(
  database: DbOrTx,
  ctx: TenantContext,
  rows: readonly Record<string, string>[],
  dateFormat: DateFormat,
): Promise<LeadImportPlan> {
  const headers = Object.keys(rows[0] ?? {});
  const col = matchColumns(headers, LEAD_COLUMNS);
  if (!col.name) throw new UserError(t("imports.leads.noName"));
  const tenantId = ctx.tenant.id;
  const settings = ctx.tenant.settings;
  const stages = settings.pipelineStages;
  const firstStage = stages[0];
  if (!firstStage) throw new UserError(t("leads.badStage"));
  const defs = await customFieldsFor(database, tenantId, "lead");
  const customColumns = new Set(defs.map((d) => customFieldName(d.key)));

  // Active team members by email, for the owner column.
  const members = col.owner
    ? await database
        .select({ id: memberships.id, email: user.email })
        .from(memberships)
        .innerJoin(user, eq(user.id, memberships.userId))
        .where(
          and(
            eq(memberships.tenantId, tenantId),
            eq(memberships.kind, "internal"),
            eq(memberships.status, "active"),
          ),
        )
    : [];
  const memberByEmail = new Map(members.map((m) => [normaliseText(m.email), m.id]));

  // Existing leads that could clash: same email, or same name (company compared below).
  const emails = [...new Set(rows.map((r) => cellOf(r, col.email).toLowerCase()).filter(Boolean))];
  const names = [...new Set(rows.map((r) => cellOf(r, col.name).toLowerCase()).filter(Boolean))];
  const existing =
    emails.length + names.length === 0
      ? []
      : await database
          .select({ email: leads.email, name: leads.name, company: leads.company })
          .from(leads)
          .where(
            and(
              eq(leads.tenantId, tenantId),
              or(
                emails.length > 0 ? inArray(sql`lower(trim(${leads.email}))`, emails) : undefined,
                names.length > 0 ? inArray(sql`lower(trim(${leads.name}))`, names) : undefined,
              ),
            ),
          );
  const existingKeys = new Set<string>();
  for (const e of existing) {
    if (e.email) existingKeys.add(leadKey(e.email, "", ""));
    // A row without an email matches on name + company, whatever email the stored lead has.
    existingKeys.add(leadKey("", e.name, e.company));
  }

  const seen = new Map<string, number>();
  const planned = rows.map((row, i): PlannedLead => {
    const n = i + 1;
    const errors: string[] = [];
    const warnings: string[] = [];
    const get = (c: LeadColumn) => cellOf(row, col[c]);
    const name = get("name");
    const email = get("email");
    if (!name) errors.push(t("imports.leads.nameMissing"));
    for (const [c, max] of Object.entries(MAX_LENGTH) as [LeadColumn, number][]) {
      if (get(c).length > max) errors.push(t("imports.tooLong", { field: t(COLUMN_LABEL[c]), max }));
    }
    if (email && !isEmail(email)) errors.push(t("imports.badEmail", { value: email }));

    // Stage: key or label, any case. Blank → the first stage; unknown → the first stage, with a warning.
    const stageText = normaliseText(get("stage"));
    const matched = stageText
      ? stages.find((s) => normaliseText(s.key) === stageText || normaliseText(s.label) === stageText)
      : firstStage;
    const stage = matched ?? firstStage;
    if (!matched)
      warnings.push(t("imports.leads.unknownStage", { value: get("stage"), stage: firstStage.label }));

    const valueText = get("value");
    const valueMinor = valueText ? parseMoney(valueText, settings.currency) : 0n;
    if (valueMinor === null || valueMinor < 0n) errors.push(t("imports.badAmount", { value: valueText }));

    const followText = get("followUpDate");
    const followUpDate = followText ? parseImportDate(followText, dateFormat) : null;
    if (followText && !followUpDate) errors.push(t("imports.badDate", { value: followText }));

    const ownerText = get("owner");
    const ownerId = ownerText ? (memberByEmail.get(normaliseText(ownerText)) ?? null) : null;
    if (ownerText && !ownerId) warnings.push(t("imports.leads.unknownOwner", { value: ownerText }));

    // cf_<key> columns, validated like the form. parseCsv already lower-cased the headers.
    const customRaw = Object.fromEntries(Object.entries(row).filter(([k]) => customColumns.has(k)));
    const custom = parseCustomFields(defs, customRaw);
    if (!custom.ok) {
      const labels = Object.keys(custom.errors).map(
        (k) => defs.find((d) => customFieldName(d.key) === k)?.label ?? k,
      );
      errors.push(t("imports.badCustom", { fields: labels.join(", ") }));
    }

    let duplicate = false;
    if (errors.length === 0) {
      const key = leadKey(email, name, get("company"));
      const earlier = seen.get(key);
      if (existingKeys.has(key)) {
        duplicate = true;
        warnings.length = 0;
        warnings.push(t(email ? "imports.leads.existsEmail" : "imports.leads.existsName"));
      } else if (earlier !== undefined) {
        duplicate = true;
        warnings.length = 0;
        warnings.push(t("imports.duplicateInFile", { row: earlier }));
      } else {
        seen.set(key, n);
      }
    }

    const status = rowStatus({ errors: errors.length, duplicate, warnings: warnings.length });
    const ready = status === "ready" || status === "warning";
    return {
      row: n,
      status,
      messages: [...errors, ...warnings],
      cells: [
        name,
        get("company"),
        email,
        stage.label,
        valueMinor && valueMinor > 0n ? formatMoney(valueMinor, settings.currency, settings.locale) : "",
        followUpDate ?? followText,
      ],
      lead:
        ready && custom.ok && valueMinor !== null
          ? {
              name,
              company: get("company"),
              email,
              phone: get("phone"),
              source: get("source"),
              stage: stage.key,
              valueMinor,
              notes: get("notes"),
              followUpDate,
              ownerMembershipId: ownerId,
              custom: custom.values,
            }
          : null,
    };
  });

  const used = new Set<string>();
  const columns = (Object.keys(LEAD_COLUMNS) as LeadColumn[]).flatMap((c) => {
    const header = col[c];
    if (header === undefined) return [];
    used.add(header);
    return [{ field: t(COLUMN_LABEL[c]), header }];
  });
  for (const def of defs) {
    const header = customFieldName(def.key);
    if (headers.includes(header)) {
      used.add(header);
      columns.push({ field: def.label, header });
    }
  }
  return { rows: planned, columns, ignored: headers.filter((h) => !used.has(h)) };
}

/** The plan as the dialog shows it. */
export function leadPreview(plan: LeadImportPlan): ImportPreview {
  return {
    ok: true,
    rows: plan.rows.map((r) => ({ row: r.row, status: r.status, cells: r.cells, messages: r.messages })),
    counts: countRows(plan.rows),
    columns: plan.columns,
    ignored: plan.ignored,
  };
}

/**
 * Imports the rows that passed, all in one database transaction (a failure leaves
 * nothing behind). Each lead goes through `createLead`, so stage, owner, audit and
 * backup sync behave exactly like the form; one more audit entry records the counts.
 */
export async function importLeads(
  database: Database,
  ctx: TenantContext,
  rows: readonly Record<string, string>[],
  dateFormat: DateFormat,
): Promise<ImportCounts & { imported: number }> {
  requirePermission(ctx, "leads.write");
  return database.transaction(async (tx) => {
    const plan = await planLeadImport(tx, ctx, rows, dateFormat);
    let imported = 0;
    for (const r of plan.rows) {
      if (!r.lead) continue;
      await createLead(tx, ctx, r.lead);
      imported++;
    }
    const counts = { ...countRows(plan.rows), imported };
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "lead.import",
      entityType: "lead",
      data: counts,
    });
    return counts;
  });
}
