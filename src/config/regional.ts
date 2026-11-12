import { regionalSchema, type RegionalConfig } from "./schema.ts";

/**
 * ✏️ Currencies, time zones, number formats and exchange rates.
 * The currency and time-zone lists come from the runtime (Intl), so only the
 * curated format list and the time zone → currency guesses live here.
 */
const regional: RegionalConfig = {
  locales: [
    "en-AU",
    "en-NZ",
    "en-US",
    "en-GB",
    "en-CA",
    "en-IE",
    "en-IN",
    "en-SG",
    "en-MY",
    "en-AE",
    "en-ZA",
    "bn-BD",
    "bn-IN",
    "hi-IN",
    "ur-PK",
    "ar-AE",
    "ms-MY",
    "fr-FR",
    "de-DE",
    "es-ES",
  ],
  timeZoneCurrency: {
    "Asia/Dhaka": "BDT",
    "Australia/": "AUD",
    "Pacific/Auckland": "NZD",
    "Europe/London": "GBP",
    "Asia/Kolkata": "INR",
    "Asia/Calcutta": "INR",
    "Asia/Karachi": "PKR",
    "Asia/Kathmandu": "NPR",
    "Asia/Katmandu": "NPR",
    "Asia/Colombo": "LKR",
    "Asia/Singapore": "SGD",
    "Asia/Kuala_Lumpur": "MYR",
    "Asia/Dubai": "AED",
    "Asia/Riyadh": "SAR",
    "Asia/Qatar": "QAR",
    "Asia/Tokyo": "JPY",
    "America/Toronto": "CAD",
    "America/Vancouver": "CAD",
    "America/New_York": "USD",
    "America/Chicago": "USD",
    "America/Denver": "USD",
    "America/Los_Angeles": "USD",
    "Europe/Dublin": "EUR",
    "Europe/Berlin": "EUR",
    "Europe/Paris": "EUR",
    "Europe/Madrid": "EUR",
  },
  fx: {
    provider: "open-er-api",
    openErApiUrl: "https://open.er-api.com/v6",
    attributionUrl: "https://www.exchangerate-api.com",
    cacheHours: 12,
    timeoutMs: 5000,
  },
};

export const regionalConfig = regionalSchema.parse(regional);
