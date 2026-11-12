import { isIsoDate } from "./dates";

/**
 * Shared pieces of the CSV imports (leads, bank transactions): header matching,
 * dates in the shapes spreadsheets and banks export, text normalising for
 * duplicate checks, and the preview/result shapes the import dialog shows.
 * Pure: safe on the server and in the browser.
 */

/** Order of day, month and year in slash dates. ISO (2026-07-31) and month names are always understood. */
export type DateFormat = "dmy" | "mdy" | "ymd";
export const DATE_FORMATS: readonly DateFormat[] = ["dmy", "mdy", "ymd"];

/** Regions that write the month first (07/31/2026). Everyone else: day first. */
const MONTH_FIRST_REGIONS = new Set(["US", "PH", "FM", "MH", "PW"]);

/** A sensible default for the date-format select, from the business's locale ("en-AU" → dmy). */
export function defaultDateFormat(locale: string): DateFormat {
  const region = locale.split("-")[1]?.toUpperCase() ?? "";
  return MONTH_FIRST_REGIONS.has(region) ? "mdy" : "dmy";
}

export function isDateFormat(value: string): value is DateFormat {
  return (DATE_FORMATS as readonly string[]).includes(value);
}

/** "Money In (AUD)" → "moneyinaud": headers compare without case, spaces or punctuation. */
export function headerKey(header: string): string {
  return header
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * For each field, the first header in the file that matches one of its names
 * (names in order of preference). A header is used by one field only.
 */
export function matchColumns<F extends string>(
  headers: readonly string[],
  names: Readonly<Record<F, readonly string[]>>,
): Partial<Record<F, string>> {
  const out: Partial<Record<F, string>> = {};
  const used = new Set<string>();
  for (const field of Object.keys(names) as F[]) {
    for (const name of names[field]) {
      const wanted = headerKey(name);
      const found = headers.find((h) => !used.has(h) && headerKey(h) === wanted);
      if (found !== undefined) {
        out[field] = found;
        used.add(found);
        break;
      }
    }
  }
  return out;
}

/** A trimmed cell, or "" when the column isn't in the file. */
export function cellOf(row: Readonly<Record<string, string>>, column: string | undefined): string {
  return column === undefined ? "" : (row[column] ?? "").trim();
}

/** Lower case, single spaces: "  ACME  Pty Ltd" and "acme pty ltd" are the same. */
export function normaliseText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthNumber(name: string): number | null {
  const index = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return index === -1 ? null : index + 1;
}

function isoOf(year: string, month: number | string, day: number | string): string | null {
  const y = year.length === 2 ? `20${year}` : year;
  const value = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isIsoDate(value) ? value : null;
}

/**
 * A date cell → "yyyy-mm-dd", or null when it isn't a real date in the chosen
 * format. Understands 2026-07-31, 31/07/2026, 31-07-26, 31.07.2026 (day or month
 * first as chosen; "ymd" accepts ISO only), 31 Jul 2026, Jul 31, 2026, and a
 * trailing time ("2026-07-31 00:00:00", "2026-07-31T09:30:00Z").
 */
export function parseImportDate(input: string, format: DateFormat): string | null {
  const value = input
    .trim()
    .replace(/[T\s]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(z|[ap]m|[+-]\d{2}:?\d{2})?$/i, "")
    .trim();
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (iso) return isoOf(iso[1] ?? "", iso[2] ?? "", iso[3] ?? "");
  const dayName = /^(\d{1,2})[\s\-/.]+([a-z]{3,9})\.?[\s\-/.,]+(\d{4}|\d{2})$/i.exec(value);
  if (dayName) {
    const month = monthNumber(dayName[2] ?? "");
    return month ? isoOf(dayName[3] ?? "", month, dayName[1] ?? "") : null;
  }
  const nameDay = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value);
  if (nameDay) {
    const month = monthNumber(nameDay[1] ?? "");
    return month ? isoOf(nameDay[3] ?? "", month, nameDay[2] ?? "") : null;
  }
  const slashed = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(value);
  if (slashed && format !== "ymd") {
    const [, a = "", b = "", year = ""] = slashed;
    return format === "mdy" ? isoOf(year, a, b) : isoOf(year, b, a);
  }
  return null;
}

/* ─── What the import dialog shows ─────────────────────────────── */

/**
 * ready: will be imported · warning: will be imported, with a note ·
 * duplicate: already there (or earlier in the file), skipped · error: can't be imported.
 */
export type ImportRowStatus = "ready" | "warning" | "duplicate" | "error";

export type ImportRowView = {
  /** 1 = the first row under the header. */
  row: number;
  status: ImportRowStatus;
  /** Display values, one per preview column. */
  cells: string[];
  messages: string[];
};

export type ImportCounts = {
  total: number;
  /** Rows that will be (or were) imported, warnings included. */
  ready: number;
  duplicates: number;
  failed: number;
};

export type ImportPreview =
  | {
      ok: true;
      rows: ImportRowView[];
      counts: ImportCounts;
      /** Which header fills which field, e.g. { field: "Date", header: "Posted date" }. */
      columns: { field: string; header: string }[];
      /** Headers the import doesn't use. */
      ignored: string[];
    }
  | { ok: false; message: string };

export type ImportResult =
  { ok: true; message: string; counts: ImportCounts & { imported: number } } | { ok: false; message: string };

export function countRows(rows: readonly { status: ImportRowStatus }[]): ImportCounts {
  const counts: ImportCounts = { total: rows.length, ready: 0, duplicates: 0, failed: 0 };
  for (const r of rows) {
    if (r.status === "ready" || r.status === "warning") counts.ready++;
    else if (r.status === "duplicate") counts.duplicates++;
    else counts.failed++;
  }
  return counts;
}

/** Row status from what was found: errors win over duplicates, duplicates over warnings. */
export function rowStatus(found: { errors: number; duplicate: boolean; warnings: number }): ImportRowStatus {
  if (found.errors > 0) return "error";
  if (found.duplicate) return "duplicate";
  return found.warnings > 0 ? "warning" : "ready";
}

/** A sample file as a link target (no script needed to download it). */
export function csvDataUrl(table: readonly (readonly string[])[]): string {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const text = table.map((row) => row.map(esc).join(",")).join("\r\n");
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`${text}\r\n`)}`;
}
