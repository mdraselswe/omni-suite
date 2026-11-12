import { lists } from "@/config";

/** A page's `searchParams` after awaiting. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** Which page of a list the URL asks for, already clamped to allowed values. */
export type PageRequest = {
  /** 1-based page number. */
  page: number;
  /** Rows per page (one of `sizes`). */
  size: number;
  /** Rows to skip: (page - 1) × size. */
  offset: number;
  sizes: readonly number[];
  defaultSize: number;
  /** URL parameter names. A prefix lets two lists on one screen page separately. */
  keys: { page: string; size: string };
};

/** One page of rows plus the total that matches the filters. */
export type Paged<T> = { rows: T[]; total: number; page: number; size: number };

/** Upper bound so `?page=1e30` can't turn into an absurd OFFSET. */
const MAX_PAGE = 1_000_000;

function single(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : (value?.[0] ?? "");
}

/** Reads `page` and `size` (or `<prefix>page`, `<prefix>size`) from the URL. Anything invalid falls back. */
export function parsePage(
  sp: SearchParams,
  options: { prefix?: string; sizes?: readonly number[]; defaultSize?: number } = {},
): PageRequest {
  const sizes = options.sizes ?? lists.pageSizes;
  const defaultSize = options.defaultSize ?? lists.defaultPageSize;
  const prefix = options.prefix ?? "";
  const keys = { page: `${prefix}page`, size: `${prefix}size` };
  const rawSize = single(sp[keys.size]);
  const size = /^\d+$/.test(rawSize) && sizes.includes(Number(rawSize)) ? Number(rawSize) : defaultSize;
  const rawPage = single(sp[keys.page]);
  const page = /^\d+$/.test(rawPage) ? Math.min(Math.max(Number(rawPage), 1), MAX_PAGE) : 1;
  return { page, size, offset: (page - 1) * size, sizes, defaultSize, keys };
}

/** A fixed first page of `size` rows (short lists on detail pages). */
export function firstPage(size: number): PageRequest {
  return {
    page: 1,
    size,
    offset: 0,
    sizes: [size],
    defaultSize: size,
    keys: { page: "page", size: "size" },
  };
}

/**
 * Runs the count and the page query together. A page past the end (an old link after
 * rows were deleted) shows the last page instead of an empty list.
 */
export async function paginate<T>(
  req: PageRequest,
  count: () => Promise<number>,
  rows: (limit: number, offset: number) => Promise<T[]>,
): Promise<Paged<T>> {
  const [total, found] = await Promise.all([count(), rows(req.size, req.offset)]);
  if (found.length === 0 && total > 0 && req.offset >= total) {
    const last = Math.ceil(total / req.size);
    return { rows: await rows(req.size, (last - 1) * req.size), total, page: last, size: req.size };
  }
  return { rows: found, total, page: req.page, size: req.size };
}

export type PageInfo = {
  page: number;
  size: number;
  total: number;
  pageCount: number;
  /** 1-based number of the first row shown (0 when empty). */
  from: number;
  /** 1-based number of the last row shown. */
  to: number;
};

export function pageInfo({ page, size, total }: { page: number; size: number; total: number }): PageInfo {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(page, 1), pageCount);
  const from = total === 0 ? 0 : (current - 1) * size + 1;
  return { page: current, size, total, pageCount, from, to: Math.min(current * size, total) };
}

/**
 * Page numbers to show, with "gap" where pages are skipped:
 * first, last, and the current page with `siblings` on each side, e.g. 1 … 4 5 6 … 20.
 * A gap never hides a single page (that page is shown instead).
 */
export function pageItems(current: number, pageCount: number, siblings = 1): (number | "gap")[] {
  const shown = new Set<number>([1, pageCount]);
  // Keep the run near either end as long as one in the middle, so the row doesn't jump in width.
  const span = siblings * 2 + 3;
  const start = Math.max(1, Math.min(current - siblings, pageCount - span + 1));
  const end = Math.min(pageCount, Math.max(current + siblings, span));
  for (let p = start; p <= end; p++) shown.add(p);
  const pages = [...shown].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  let previous = 0;
  for (const p of pages) {
    if (p - previous === 2) items.push(p - 1);
    else if (p - previous > 2) items.push("gap");
    items.push(p);
    previous = p;
  }
  return items;
}

/**
 * Query string of the current URL with some parameters changed; `null`, `undefined`
 * and "" remove one. Other filters stay as they are. Returns "" or "?a=1&b=2".
 */
export function queryWith(
  sp: SearchParams,
  changes: Record<string, string | number | null | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (key in changes) continue;
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Changes that open `page` of the list (page 1 and the default size are left out of the URL). */
export function pageChanges(req: PageRequest, page: number, size = req.size) {
  return {
    [req.keys.page]: page > 1 ? page : null,
    [req.keys.size]: size === req.defaultSize ? null : size,
  };
}

/** Hidden fields for a filter form, so filtering keeps the chosen page size (and starts at page 1). */
export function keepSize(req: PageRequest): Record<string, string | undefined> {
  return { [req.keys.size]: req.size === req.defaultSize ? undefined : String(req.size) };
}
