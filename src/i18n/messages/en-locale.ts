/**
 * OmniSuite UI strings: currency, time zone and format pickers, exchange rates. Merged into `en`.
 */
export const enLocale = {
  // Searchable pickers
  "picker.search": "Type to search",
  "picker.open": "Show options",
  "picker.empty": "No matches. Try a code or another word.",

  // Settings and new business
  "locale.currency": "Business currency",
  "locale.currencyHint":
    "Reports, profit and totals use this currency. It can't change once money is recorded.",
  "locale.currencyLocked":
    "Locked: money is already recorded in {currency}. Changing it would make every saved total wrong.",
  "locale.currencyLockedError":
    "The business currency can't change after money has been recorded (transactions, invoices, proposals or capital). Every saved total is in {currency}.",
  "locale.timezone": "Time zone",
  "locale.format": "Number & date format",
  "locale.fyStart": "Financial year starts in",
  "locale.regionHint": "Guessed from this device. You can change both later in Settings.",
  "locale.badCurrency": "Choose a currency from the list.",
  "locale.badTimezone": "Choose a time zone from the list.",
  "locale.badFormat": "Choose a format from the list.",
  "locale.accountCurrencyHint":
    "The currency this bank, card or wallet holds. Usually your business currency.",

  // Exchange rate on a transaction
  "fx.rateLabel": "Exchange rate: 1 {from} = ? {to}",
  "fx.rateHint": "Use the rate your bank or card actually charged if you know it. You can edit it.",
  "fx.useToday": "Use today's rate",
  "fx.loading": "Getting rate…",
  "fx.failed": "Couldn't get today's rate. Type the rate from your bank or card statement.",
  "fx.filled": "Market rate from {date} filled in. Check it against your statement.",
  "fx.attribution": "Rates by ExchangeRate-API",
  "fx.preview": "{amount} ≈ {base}",
  "fx.previewLabel": "In {currency}",
} as const;
