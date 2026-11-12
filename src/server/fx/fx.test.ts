// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRateCache, openErApi } from "./index";

const API = "https://fx.example.test/v6";

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const audTable = {
  result: "success",
  base_code: "AUD",
  time_last_update_unix: 1_794_441_600,
  rates: { AUD: 1, BDT: 78.5, USD: 0.65 },
};

describe("open.er-api.com provider", () => {
  it("asks only for the base currency code and parses the table", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => reply(audTable));
    const table = await openErApi(API, fetchMock).table("AUD", AbortSignal.timeout(1000));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/latest/AUD`);
    expect(table.rates.BDT).toBe(78.5);
    expect(table.asOf.toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });

  it("throws on an error answer", async () => {
    const provider = openErApi(
      API,
      vi.fn<typeof fetch>(async () => reply({ result: "error", "error-type": "unsupported-code" })),
    );
    await expect(provider.table("AUD", AbortSignal.timeout(1000))).rejects.toThrow();
    const down = openErApi(
      API,
      vi.fn<typeof fetch>(async () => reply({}, 503)),
    );
    await expect(down.table("AUD", AbortSignal.timeout(1000))).rejects.toThrow(/503/);
  });
});

describe("rate cache", () => {
  it("quotes base per foreign unit and reuses the table until it expires", async () => {
    let clock = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => reply(audTable));
    const provider = openErApi(API, fetchMock);
    const cache = createRateCache({ ttlMs: 1000, timeoutMs: 1000, now: () => clock });

    expect(await cache.quote(provider, "BDT", "AUD")).toEqual({
      rate: "0.01273885",
      asOf: "2026-11-12T00:00:00.000Z",
    });
    expect((await cache.quote(provider, "USD", "AUD"))?.rate).toBe("1.53846154");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock = 1001;
    await cache.quote(provider, "BDT", "AUD");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 1 for the base currency without asking", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const cache = createRateCache({ ttlMs: 1000, timeoutMs: 1000 });
    expect((await cache.quote(openErApi(API, fetchMock), "AUD", "AUD"))?.rate).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives null on failure or an unknown currency, and retries next time", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(reply(audTable));
    const provider = openErApi(API, fetchMock);
    const cache = createRateCache({ ttlMs: 1000, timeoutMs: 1000 });

    expect(await cache.quote(provider, "BDT", "AUD")).toBeNull();
    expect((await cache.quote(provider, "BDT", "AUD"))?.rate).toBe("0.01273885");
    expect(await cache.quote(provider, "XYZ", "AUD")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
