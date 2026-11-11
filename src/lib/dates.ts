/**
 * Calendar dates as ISO strings ("2026-07-01"). Business dates are plain days in
 * the tenant's time zone, so they never shift with the server's clock.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today in a time zone, e.g. today("Australia/Sydney"). */
export function today(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function parse(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

/** Adds months, clamping to the last day (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  const d = parse(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return fmt(d);
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function monthEnd(iso: string): string {
  return addDays(addMonths(monthStart(iso), 1), -1);
}

/** Start of the fiscal year containing `iso` (Australia: startMonth 7 → 1 July). */
export function fiscalYearStart(iso: string, startMonth: number): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  return `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parse(toIso).getTime() - parse(fromIso).getTime()) / 86_400_000);
}

/** "12 Jul 2026" in the tenant locale. */
export function formatDate(iso: string | null | undefined, locale = "en-AU"): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parse(iso));
}

/** "Jul 2026". */
export function formatMonth(iso: string, locale = "en-AU"): string {
  return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(
    parse(iso),
  );
}

export function formatDateTime(value: Date | null | undefined, timeZone: string, locale = "en-AU"): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(value);
}

/** Minutes → "3h 05m". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** "1.5" / "1:30" / "90m" → minutes. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+):([0-5]\d)$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d+)\s*m(in)?$/))) return Number(m[1]);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h?$/))) return Math.round(Number(m[1]) * 60);
  return null;
}
