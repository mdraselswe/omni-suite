/**
 * Option lists for currency, time zone, number format and month pickers, built
 * from the runtime's Intl data (no hand-kept lists). Pure: safe on server and client.
 */

export type Option = { value: string; label: string };

const DISPLAY_LOCALE = "en";

/* ─── Currencies ───────────────────────────────────────────────── */

export function supportedCurrencies(): string[] {
  return Intl.supportedValuesOf("currency");
}

export function isSupportedCurrency(code: string): boolean {
  return supportedCurrencies().includes(code);
}

/** "BDT — Bangladeshi Taka", sorted by code. */
export function currencyOptions(displayLocale = DISPLAY_LOCALE): Option[] {
  const names = new Intl.DisplayNames(displayLocale, { type: "currency", fallback: "code" });
  return supportedCurrencies().map((code) => {
    const name = names.of(code);
    return { value: code, label: name && name !== code ? `${code} — ${name}` : code };
  });
}

/* ─── Time zones ───────────────────────────────────────────────── */

export function supportedTimeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : [...zones, "UTC"];
}

/** The runtime's own name for a zone ("Asia/Kolkata" may come back as "Asia/Calcutta"), or null if unknown. */
function resolveTimeZone(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** True for an IANA zone the runtime knows, under its listed name or an alias of it. */
export function isSupportedTimeZone(zone: string): boolean {
  if (!zone) return false;
  const zones = supportedTimeZones();
  if (zones.includes(zone)) return true;
  const resolved = resolveTimeZone(zone);
  return resolved !== null && zones.includes(resolved);
}

/** "UTC+06:00" for Asia/Dhaka at `at` (daylight saving depends on the date). */
export function utcOffset(zone: string, at: Date): string {
  try {
    const part = new Intl.DateTimeFormat(DISPLAY_LOCALE, { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!part || part === "GMT") return "UTC+00:00";
    return part.replace(/^GMT/, "UTC");
  } catch {
    return "";
  }
}

/** "Asia/Dhaka (UTC+06:00)", sorted by name. */
export function timeZoneOptions(at: Date): Option[] {
  return supportedTimeZones()
    .toSorted((a, b) => a.localeCompare(b))
    .map((zone) => {
      const offset = utcOffset(zone, at);
      return { value: zone, label: offset ? `${zone} (${offset})` : zone };
    });
}

/* ─── Number & date formats ────────────────────────────────────── */

/** "English (Australia) — en-AU" for each configured locale the runtime can format. */
export function localeOptions(locales: readonly string[], displayLocale = DISPLAY_LOCALE): Option[] {
  const names = new Intl.DisplayNames(displayLocale, { type: "language", languageDisplay: "standard" });
  return locales.filter(isFormattableLocale).map((tag) => {
    const name = names.of(tag);
    return { value: tag, label: name && name !== tag ? `${name} — ${tag}` : tag };
  });
}

export function isFormattableLocale(tag: string): boolean {
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length > 0;
  } catch {
    return false;
  }
}

/* ─── Months ───────────────────────────────────────────────────── */

/** 1 → "January" … 12 → "December" in `locale`. */
export function monthOptions(locale = DISPLAY_LOCALE): Option[] {
  const format = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: format.format(new Date(Date.UTC(2000, i, 1))),
  }));
}

/* ─── Helpers ──────────────────────────────────────────────────── */

/** Keeps a saved value selectable even if it isn't in today's list (e.g. an older alias). */
export function withCurrent(options: Option[], current: string): Option[] {
  if (!current || options.some((o) => o.value === current)) return options;
  return [{ value: current, label: current }, ...options];
}

/**
 * Best-guess currency for a time zone from a map like { "Asia/Dhaka": "BDT", "Australia/": "AUD" }.
 * Exact keys win; a key ending in "/" matches the whole region.
 */
export function currencyForTimeZone(zone: string, map: Readonly<Record<string, string>>): string | null {
  const exact = map[zone];
  if (exact) return exact;
  const region = Object.keys(map)
    .filter((key) => key.endsWith("/") && zone.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  return region ? (map[region] ?? null) : null;
}
