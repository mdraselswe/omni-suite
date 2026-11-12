import { describe, expect, it } from "vitest";
import { lists } from "@/config";
import {
  firstPage,
  keepSize,
  pageChanges,
  pageInfo,
  pageItems,
  paginate,
  parsePage,
  queryWith,
} from "./pagination";
import { containsPattern, normaliseSearch, searchTerms } from "./search";

describe("parsePage", () => {
  it("defaults to page 1 at the configured size", () => {
    const req = parsePage({});
    expect(req).toMatchObject({ page: 1, size: lists.defaultPageSize, offset: 0 });
  });

  it("reads page and an allowed size, and computes the offset", () => {
    expect(parsePage({ page: "3", size: "25" })).toMatchObject({ page: 3, size: 25, offset: 50 });
  });

  it("ignores sizes that aren't offered and junk page numbers", () => {
    for (const size of ["7", "1000", "-25", "25.5", "abc", ""]) {
      expect(parsePage({ size }).size, size).toBe(lists.defaultPageSize);
    }
    for (const page of ["0", "-2", "1.5", "abc", "", "1e3"]) {
      expect(parsePage({ page }).page, page).toBe(1);
    }
    expect(parsePage({ page: "999999999999" }).page).toBe(1_000_000);
    expect(parsePage({ page: ["4", "9"] }).page).toBe(4);
  });

  it("supports a prefix for a second list on the same screen", () => {
    const req = parsePage({ page: "2", ppage: "5", psize: "100" }, { prefix: "p" });
    expect(req).toMatchObject({ page: 5, size: 100, offset: 400, keys: { page: "ppage", size: "psize" } });
  });

  it("firstPage is a fixed short page", () => {
    expect(firstPage(10)).toMatchObject({ page: 1, size: 10, offset: 0 });
  });
});

describe("pageInfo", () => {
  it("shows the row range", () => {
    expect(pageInfo({ page: 2, size: 50, total: 1234 })).toEqual({
      page: 2,
      size: 50,
      total: 1234,
      pageCount: 25,
      from: 51,
      to: 100,
    });
    expect(pageInfo({ page: 25, size: 50, total: 1234 })).toMatchObject({ from: 1201, to: 1234 });
  });

  it("handles an empty list and clamps the page", () => {
    expect(pageInfo({ page: 3, size: 25, total: 0 })).toMatchObject({
      page: 1,
      pageCount: 1,
      from: 0,
      to: 0,
    });
    expect(pageInfo({ page: 9, size: 25, total: 30 })).toMatchObject({ page: 2, from: 26, to: 30 });
  });
});

describe("pageItems", () => {
  it("lists every page when there are few", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("puts gaps around the current page, keeping a steady width", () => {
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(pageItems(4, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(pageItems(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageItems(17, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
    expect(pageItems(20, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
  });

  it("never hides a single page behind a gap", () => {
    for (let current = 1; current <= 12; current++) {
      const items = pageItems(current, 12);
      items.forEach((item, i) => {
        if (item !== "gap") return;
        const before = items[i - 1];
        const after = items[i + 1];
        expect(typeof before === "number" && typeof after === "number" && after - before > 2).toBe(true);
      });
      expect(items).toContain(current);
    }
  });
});

describe("queryWith and pageChanges", () => {
  it("keeps other filters and drops defaults", () => {
    const sp = { q: "acme", status: "active", page: "3" };
    const req = parsePage(sp);
    expect(queryWith(sp, pageChanges(req, 4))).toBe("?q=acme&status=active&page=4");
    expect(queryWith(sp, pageChanges(req, 1))).toBe("?q=acme&status=active");
    expect(queryWith(sp, pageChanges(req, 1, 100))).toBe("?q=acme&status=active&size=100");
    expect(queryWith({ page: "2" }, { page: null })).toBe("");
  });

  it("removes a search and keeps repeated params", () => {
    expect(queryWith({ q: "x", tag: ["a", "b"], page: "2" }, { q: null, page: null })).toBe("?tag=a&tag=b");
  });

  it("keepSize carries a non-default size into filter forms", () => {
    expect(keepSize(parsePage({ size: "100" }))).toEqual({ size: "100" });
    expect(keepSize(parsePage({}))).toEqual({ size: undefined });
  });
});

describe("paginate", () => {
  const data = Array.from({ length: 23 }, (_, i) => i + 1);
  const count = async () => data.length;
  const rows = async (limit: number, offset: number) => data.slice(offset, offset + limit);

  it("returns the page and the total", async () => {
    const req = parsePage({ page: "2", size: "10" }, { sizes: [10, 25] });
    expect(await paginate(req, count, rows)).toEqual({
      rows: data.slice(10, 20),
      total: 23,
      page: 2,
      size: 10,
    });
  });

  it("falls back to the last page when the page is past the end", async () => {
    const req = parsePage({ page: "9", size: "10" }, { sizes: [10] });
    expect(await paginate(req, count, rows)).toEqual({ rows: [21, 22, 23], total: 23, page: 3, size: 10 });
    const wide = parsePage({ page: "2", size: "25" }, { sizes: [25] });
    expect(await paginate(wide, count, rows)).toEqual({ rows: data, total: 23, page: 1, size: 25 });
  });

  it("an empty list stays on page 1", async () => {
    const req = parsePage({ page: "4" });
    expect(
      await paginate(
        req,
        async () => 0,
        async () => [],
      ),
    ).toEqual({
      rows: [],
      total: 0,
      page: 4,
      size: lists.defaultPageSize,
    });
  });
});

describe("search text", () => {
  it("normalises spaces and length", () => {
    expect(normaliseSearch("  acme   web  ")).toBe("acme web");
    expect(normaliseSearch(undefined)).toBe("");
    expect(normaliseSearch("x".repeat(500))).toHaveLength(lists.searchMaxLength);
  });

  it("splits into at most five words", () => {
    expect(searchTerms(" a b  c d e f g")).toEqual(["a", "b", "c", "d", "e"]);
    expect(searchTerms("   ")).toEqual([]);
  });

  it("escapes LIKE wildcards instead of dropping them", () => {
    expect(containsPattern("50%_off")).toBe("%50\\%\\_off%");
    expect(containsPattern("a\\b")).toBe("%a\\\\b%");
    expect(containsPattern("INV-0012")).toBe("%INV-0012%");
  });
});
