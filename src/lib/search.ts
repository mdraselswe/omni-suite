import { lists } from "@/config";

/** Most separate words a search matches on (the rest are ignored). */
const MAX_TERMS = 5;

/**
 * Search text as the lists use it: spaces collapsed, trimmed, cut to the configured length.
 * Runs in the browser (search box) and on the server (query), so both agree on the value.
 */
export function normaliseSearch(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, lists.searchMaxLength).trim();
}

/** Words of a search; every word must match somewhere for a row to be found. */
export function searchTerms(q: string): string[] {
  return normaliseSearch(q).split(" ").filter(Boolean).slice(0, MAX_TERMS);
}

/**
 * `%term%` for ILIKE, with LIKE's wildcards escaped so they match themselves:
 * "50%_off" finds the text "50%_off" instead of matching anything.
 * Postgres' default LIKE escape character is the backslash.
 */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
