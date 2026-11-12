import "server-only";
import { z } from "zod";
import type { FxProvider, RateTable } from "./types";

const response = z.object({
  result: z.literal("success"),
  base_code: z.string(),
  time_last_update_unix: z.number(),
  rates: z.record(z.string(), z.number()),
});

/**
 * open.er-api.com (ExchangeRate-API's free, keyless endpoint). Updates daily,
 * includes BDT. Terms require the "Rates by ExchangeRate-API" link near the rate.
 * Only the base currency code is sent.
 */
export function openErApi(
  apiUrl: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): FxProvider {
  return {
    key: "open-er-api",
    async table(base, signal): Promise<RateTable> {
      const res = await fetchImpl(`${apiUrl.replace(/\/$/, "")}/latest/${encodeURIComponent(base)}`, {
        signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`open.er-api.com answered ${res.status}`);
      const body = response.parse(await res.json());
      if (body.base_code !== base) throw new Error("open.er-api.com returned another base currency");
      return { base, rates: body.rates, asOf: new Date(body.time_last_update_unix * 1000) };
    },
  };
}
