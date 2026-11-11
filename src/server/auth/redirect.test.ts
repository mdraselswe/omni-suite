import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("keeps same-app paths with their query and hash", () => {
    expect(safeNextPath("/demo/finance/")).toBe("/demo/finance/");
    expect(safeNextPath("/invite/abc?x=1#top")).toBe("/invite/abc?x=1#top");
    expect(safeNextPath("/a/../b")).toBe("/b");
  });

  it("rejects anything that could leave the app", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "/\\/evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "https://evil.com",
      "evil.com",
      "javascript:alert(1)",
      "",
      " /x",
    ]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });

  it("falls back for non-strings and uses a custom fallback", () => {
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(["/a"])).toBe("/");
    expect(safeNextPath("//x", "/login")).toBe("/login");
  });
});
