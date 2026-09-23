import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORMAT_SETTINGS,
  formatCalendarDate,
  formatNumber,
  isoDateToLocal,
  localToIsoDate,
  todayIsoDate,
} from "./format";

const settings = { ...DEFAULT_FORMAT_SETTINGS, numberLocale: "en-US" };

describe("formatNumber", () => {
  it("formats plain numbers with grouping and fixed decimals", () => {
    expect(formatNumber(12480, {}, settings)).toBe("12,480");
    expect(formatNumber(3.14159, { decimals: 2 }, settings)).toBe("3.14");
  });

  it("formats percentages from ratios", () => {
    expect(formatNumber(0.342, { style: "percent", decimals: 1 }, settings)).toBe("34.2%");
  });

  it("uses the settings locale, not the UI language", () => {
    const cz = formatNumber(184500, { style: "currency", currency: "CZK" });
    expect(cz.replace(/\s/g, " ")).toBe("184 500 Kč");
  });
});

describe("calendar dates", () => {
  it("round-trips ISO dates without time-zone drift", () => {
    expect(localToIsoDate(isoDateToLocal("2026-12-01"))).toBe("2026-12-01");
  });

  it("formats with the configured pattern", () => {
    expect(formatCalendarDate("2026-12-01")).toBe("1. 12. 2026");
  });

  it("computes today in the user's zone, not UTC", () => {
    const lateUtc = new Date("2026-09-23T23:30:00Z");
    expect(todayIsoDate({ ...settings, timeZone: "Europe/Prague" }, lateUtc)).toBe("2026-09-24");
    expect(todayIsoDate({ ...settings, timeZone: "America/New_York" }, lateUtc)).toBe("2026-09-23");
  });
});
