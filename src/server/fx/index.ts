import "server-only";
import { regionalConfig } from "@/config";
import { serverEnv } from "@/config/env";
import { formatRate, invertRate } from "@/lib/fx";
import { openErApi } from "./open-er-api";
import type { FxProvider, FxQuote, RateTable } from "./types";

export type { FxProvider, FxQuote, RateTable } from "./types";
export { openErApi } from "./open-er-api";

/** The configured provider, or null when rates are switched off. */
export function fxProvider(): FxProvider | null {
  const key = serverEnv().FX_PROVIDER ?? regionalConfig.fx.provider;
  switch (key) {
    case "open-er-api":
      return openErApi(regionalConfig.fx.openErApiUrl);
    case "off":
      return null;
  }
}

type Entry = { expires: number; table: Promise<RateTable> };

/**
 * Fetches and caches rate tables in server memory, one per provider and base
 * currency. A failed fetch isn't cached, so the next click tries again.
 */
export function createRateCache(options: { ttlMs: number; timeoutMs: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  async function table(provider: FxProvider, base: string): Promise<RateTable> {
    const key = `${provider.key}:${base}`;
    const hit = entries.get(key);
    if (hit && hit.expires > now()) return hit.table;
    const pending = provider.table(base, AbortSignal.timeout(options.timeoutMs));
    entries.set(key, { expires: now() + options.ttlMs, table: pending });
    try {
      return await pending;
    } catch (error) {
      if (entries.get(key)?.table === pending) entries.delete(key);
      throw error;
    }
  }

  /** Base-currency units for 1 `foreign`, or null if the provider can't say. */
  async function quote(provider: FxProvider, foreign: string, base: string): Promise<FxQuote | null> {
    if (foreign === base) return { rate: "1", asOf: new Date(now()).toISOString() };
    try {
      const t = await table(provider, base);
      const perBase = t.rates[foreign];
      const rate = perBase === undefined ? null : formatRate(invertRate(perBase) ?? Number.NaN);
      return rate ? { rate, asOf: t.asOf.toISOString() } : null;
    } catch (error) {
      console.warn(
        `[fx] ${provider.key} failed for ${base}:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  return { quote, clear: () => entries.clear() };
}

const shared = createRateCache({
  ttlMs: regionalConfig.fx.cacheHours * 60 * 60 * 1000,
  timeoutMs: regionalConfig.fx.timeoutMs,
});

/** Today's market rate (base per 1 foreign unit) from the configured provider, or null. */
export async function latestRate(foreign: string, base: string): Promise<FxQuote | null> {
  const provider = fxProvider();
  return provider ? shared.quote(provider, foreign, base) : null;
}
