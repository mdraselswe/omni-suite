// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const lookups: string[] = [];
vi.mock("postgres", () => ({
  default: () => async (_strings: TemplateStringsArray, host: string) => {
    lookups.push(host);
    return host === "portal.example.com" ? [{ slug: "acme" }] : [];
  },
}));

beforeEach(async () => {
  const { clearHostCache } = await import("./hosts");
  clearHostCache();
  lookups.length = 0;
});

describe("custom domain lookups", () => {
  it("caches hits and misses, and never queries for junk hosts", async () => {
    const { slugForHost } = await import("./hosts");
    expect(await slugForHost("portal.example.com")).toBe("acme");
    expect(await slugForHost("portal.example.com")).toBe("acme");
    expect(await slugForHost("unknown.example.com")).toBeNull();
    expect(await slugForHost("unknown.example.com")).toBeNull();
    expect(await slugForHost("no-dot")).toBeNull();
    expect(await slugForHost("bad host.example.com")).toBeNull();
    expect(lookups).toEqual(["portal.example.com", "unknown.example.com"]);
  });

  it("keeps the cache bounded", async () => {
    const { HOST_CACHE_MAX, hostCacheSize, slugForHost } = await import("./hosts");
    for (let i = 0; i < HOST_CACHE_MAX + 50; i++) await slugForHost(`h${i}.example.com`);
    expect(hostCacheSize()).toBe(HOST_CACHE_MAX);
  });

  it("uses Host, not the client-controlled X-Forwarded-Host", async () => {
    const { requestHost } = await import("./hosts");
    const headers = new Headers({ host: "Portal.Example.com:443", "x-forwarded-host": "evil.example.com" });
    expect(requestHost(headers)).toBe("portal.example.com");
  });
});
