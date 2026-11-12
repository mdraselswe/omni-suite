"use client";

import { useSyncExternalStore } from "react";
import { ComboboxField, type ComboboxOption } from "@/components/form/combobox-field";
import { regionalConfig } from "@/config";
import { t } from "@/i18n";
import { currencyForTimeZone } from "@/lib/intl-options";

const subscribe = () => () => {};
const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const noTimeZone = () => null;

/**
 * Currency and time zone for a new business. The server renders the defaults;
 * in the browser both are guessed from the device's time zone
 * (Asia/Dhaka → BDT, Australia/* → AUD). The person can change either.
 */
export function RegionFields({
  currencies,
  timeZones,
  defaultCurrency,
  defaultTimeZone,
}: {
  currencies: ComboboxOption[];
  timeZones: ComboboxOption[];
  defaultCurrency: string;
  defaultTimeZone: string;
}) {
  const device = useSyncExternalStore(subscribe, deviceTimeZone, noTimeZone);
  const zone = device && timeZones.some((z) => z.value === device) ? device : defaultTimeZone;
  const guess = zone === device ? currencyForTimeZone(zone, regionalConfig.timeZoneCurrency) : null;
  const currency = guess && currencies.some((c) => c.value === guess) ? guess : defaultCurrency;

  // Keyed so the guess replaces the server default once, right after hydration.
  return (
    <div className="grid gap-4">
      <ComboboxField
        key={`tz-${zone}`}
        name="timezone"
        label={t("locale.timezone")}
        options={timeZones}
        defaultValue={zone}
        required
      />
      <ComboboxField
        key={`cur-${currency}`}
        name="currency"
        label={t("locale.currency")}
        hint={t("locale.regionHint")}
        options={currencies}
        defaultValue={currency}
        required
      />
    </div>
  );
}
