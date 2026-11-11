import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysBetween,
  fiscalYearStart,
  formatMinutes,
  isIsoDate,
  monthEnd,
  parseDuration,
  today,
} from "./dates";

describe("dates", () => {
  it("validates ISO dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("26-2-1")).toBe(false);
  });

  it("gives today in the tenant time zone", () => {
    // 14:00 UTC on 30 June is already 1 July in Sydney.
    expect(today("Australia/Sydney", new Date("2026-06-30T14:30:00Z"))).toBe("2026-07-01");
  });

  it("adds days and months with clamping", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
  });

  it("finds the Australian fiscal year start", () => {
    expect(fiscalYearStart("2026-06-30", 7)).toBe("2025-07-01");
    expect(fiscalYearStart("2026-07-01", 7)).toBe("2026-07-01");
    expect(fiscalYearStart("2026-03-01", 1)).toBe("2026-01-01");
  });

  it("measures and formats durations", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(formatMinutes(185)).toBe("3h 05m");
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("1.5")).toBe(90);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("abc")).toBeNull();
  });
});
