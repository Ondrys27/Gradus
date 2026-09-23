import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORMAT_SETTINGS,
  formatCalendarDate,
  formatDateTime,
  formatNumber,
  formatTime,
  isoDateToLocal,
  localToIsoDate,
  todayIsoDate,
} from "./format";
import { toFormatSettings, type UserSettings } from "./user-settings";

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

  it("takes the currency from the user's settings when none is given", () => {
    expect(formatNumber(1200, { style: "currency" }, { ...settings, currency: "EUR" })).toBe(
      "€1,200",
    );
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

describe("time zone aware formatting", () => {
  // 2026-03-29 00:30 UTC is 01:30 in Prague (CET) and still the 28th in New York.
  const instant = new Date(Date.UTC(2026, 2, 29, 0, 30));

  it("formats the date and time in the user's zone, never UTC", () => {
    expect(formatDateTime(instant, DEFAULT_FORMAT_SETTINGS)).toBe("29. 3. 2026 01:30");
    expect(
      formatDateTime(instant, {
        ...DEFAULT_FORMAT_SETTINGS,
        timeZone: "America/New_York",
        dateFormat: "MM/dd/yyyy",
        timeFormat: "h:mm a",
      }),
    ).toBe("03/28/2026 8:30 PM");
  });

  it("formats a clock time alone", () => {
    expect(formatTime(instant, { ...DEFAULT_FORMAT_SETTINGS, timeZone: "Asia/Tokyo" })).toBe(
      "09:30",
    );
  });
});

describe("user settings mapping", () => {
  const row = {
    number_format: "en",
    date_format: "yyyy-MM-dd",
    time_format: "h:mm a",
    first_day_of_week: 0,
    currency: "USD",
    timezone: "America/Chicago",
  } as UserSettings;

  it("turns a user_settings row into format settings", () => {
    expect(toFormatSettings(row)).toEqual({
      numberLocale: "en-US",
      dateFormat: "yyyy-MM-dd",
      timeFormat: "h:mm a",
      weekStartsOn: 0,
      currency: "USD",
      timeZone: "America/Chicago",
    });
  });

  it("falls back to defaults for values it does not know", () => {
    const broken = { ...row, number_format: "xx", date_format: "Q", timezone: "Nowhere/City" };
    const result = toFormatSettings(broken as UserSettings);
    expect(result.numberLocale).toBe(DEFAULT_FORMAT_SETTINGS.numberLocale);
    expect(result.dateFormat).toBe(DEFAULT_FORMAT_SETTINGS.dateFormat);
    expect(result.timeZone).toBe(DEFAULT_FORMAT_SETTINGS.timeZone);
    expect(toFormatSettings(null)).toBe(DEFAULT_FORMAT_SETTINGS);
  });
});
