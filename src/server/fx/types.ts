/** Rates against one base currency: `rates[X]` = units of X for 1 unit of `base`. */
export type RateTable = { base: string; rates: Record<string, number>; asOf: Date };

/** A source of exchange rates. Add another by implementing this and listing it in FX_PROVIDERS. */
export interface FxProvider {
  readonly key: string;
  /** Latest rates for `base`. Throws on any failure; callers fall back to a typed rate. */
  table(base: string, signal: AbortSignal): Promise<RateTable>;
}

/** What the UI shows: base-currency units for 1 unit of the foreign currency. */
export type FxQuote = { rate: string; asOf: string };
