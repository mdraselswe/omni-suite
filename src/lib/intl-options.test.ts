import { describe, expect, it } from "vitest";
import {
  currencyForTimeZone,
  currencyOptions,
  isSupportedCurrency,
  isSupportedTimeZone,
  localeOptions,
  monthOptions,
  timeZoneOptions,
  utcOffset,
  withCurrent,
} from "./intl-options";

describe("currencies", () => {
  it("lists every runtime currency with its name", () => {
    const options = currencyOptions();
    expect(options.length).toBeGreaterThan(100);
    expect(options).toContainEqual({ value: "BDT", label: "BDT — Bangladeshi Taka" });
    expect(options).toContainEqual({ value: "AUD", label: "AUD — Australian Dollar" });
    expect(options.find((o) => o.value === "USD")?.label).toBe("USD — US Dollar");
  });

  it("accepts only listed codes", () => {
    expect(isSupportedCurrency("BDT")).toBe(true);
    expect(isSupportedCurrency("bdt")).toBe(false);
    expect(isSupportedCurrency("ABC")).toBe(false);
    expect(isSupportedCurrency("")).toBe(false);
  });
});

describe("time zones", () => {
  const winter = new Date("2026-07-01T00:00:00Z");
  const summer = new Date("2026-01-01T00:00:00Z");

  it("labels zones with their UTC offset on the given date", () => {
    const options = timeZoneOptions(winter);
    expect(options.length).toBeGreaterThan(300);
    expect(options).toContainEqual({ value: "Asia/Dhaka", label: "Asia/Dhaka (UTC+06:00)" });
    expect(options).toContainEqual({ value: "UTC", label: "UTC (UTC+00:00)" });
    expect(utcOffset("Australia/Sydney", winter)).toBe("UTC+10:00");
    expect(utcOffset("Australia/Sydney", summer)).toBe("UTC+11:00");
    expect(utcOffset("Asia/Kathmandu", winter)).toBe("UTC+05:45");
  });

  it("accepts known zones and their aliases, rejects the rest", () => {
    expect(isSupportedTimeZone("Asia/Dhaka")).toBe(true);
    expect(isSupportedTimeZone("UTC")).toBe(true);
    expect(isSupportedTimeZone("Asia/Kolkata")).toBe(true);
    expect(isSupportedTimeZone("Mars/Olympus")).toBe(false);
    expect(isSupportedTimeZone("")).toBe(false);
  });

  it("guesses a currency from the zone", () => {
    const map = { "Asia/Dhaka": "BDT", "Australia/": "AUD", "Australia/Perth": "XXX" };
    expect(currencyForTimeZone("Asia/Dhaka", map)).toBe("BDT");
    expect(currencyForTimeZone("Australia/Melbourne", map)).toBe("AUD");
    expect(currencyForTimeZone("Australia/Perth", map)).toBe("XXX");
    expect(currencyForTimeZone("Europe/Oslo", map)).toBeNull();
  });
});

describe("locales and months", () => {
  it("names configured locales", () => {
    expect(localeOptions(["en-AU", "bn-BD"])).toEqual([
      { value: "en-AU", label: "English (Australia) — en-AU" },
      { value: "bn-BD", label: "Bangla (Bangladesh) — bn-BD" },
    ]);
  });

  it("lists twelve months", () => {
    const months = monthOptions("en-AU");
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ value: "1", label: "January" });
    expect(months[6]).toEqual({ value: "7", label: "July" });
  });

  it("keeps a saved value that isn't listed", () => {
    const list = [{ value: "a", label: "A" }];
    expect(withCurrent(list, "a")).toBe(list);
    expect(withCurrent(list, "b")).toEqual([{ value: "b", label: "b" }, ...list]);
  });
});
