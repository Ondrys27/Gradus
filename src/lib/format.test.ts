import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORMAT_SETTINGS,
  formatCalendarDate,
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatTime,
  isoDateToLocal,
  localToIsoDate,
  todayIsoDate,
  formatIsoTime,
  formatList,
  instantToZonedParts,
  zonedWallClockToInstant,
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

describe("formatCurrency", () => {
  it("uses the user's number format and the given currency", () => {
    expect(formatCurrency(184500, "CZK").replace(/\s/g, " ")).toBe("184 500 Kč");
    expect(formatCurrency(1200, "EUR", settings)).toBe("€1,200");
  });

  it("falls back to the currency in settings and supports decimals", () => {
    expect(formatCurrency(12.5, undefined, { ...settings, currency: "USD" }, 2)).toBe("$12.50");
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

describe("wall clock in the user's zone", () => {
  it("turns a local date and time into the stored instant", () => {
    expect(zonedWallClockToInstant("2026-09-24", "14:30", "Europe/Prague").toISOString()).toBe(
      "2026-09-24T12:30:00.000Z",
    );
    expect(zonedWallClockToInstant("2026-01-15", "09:00", "Europe/Prague").toISOString()).toBe(
      "2026-01-15T08:00:00.000Z",
    );
    expect(zonedWallClockToInstant("2026-09-24", "23:30", "America/New_York").toISOString()).toBe(
      "2026-09-25T03:30:00.000Z",
    );
  });

  it("round-trips through the parts shown for editing", () => {
    const instant = new Date("2026-03-29T00:30:00Z"); // night of the Prague DST change
    const parts = instantToZonedParts(instant, "Europe/Prague");
    expect(parts).toEqual({ date: "2026-03-29", time: "01:30" });
    expect(zonedWallClockToInstant(parts.date, parts.time, "Europe/Prague")).toEqual(instant);
  });

  it("formats a bare clock time with the user's time format", () => {
    expect(formatIsoTime("14:05", settings)).toBe("14:05");
    expect(formatIsoTime("14:05", { ...settings, timeFormat: "h:mm a" })).toBe("2:05 PM");
  });
});

describe("formatList", () => {
  it("joins with the conjunction of the UI language", () => {
    expect(formatList(["a", "b", "c"], "en")).toBe("a, b, and c");
    // Czech keeps the "a" glued to the next word with a no-break space.
    expect(formatList(["a", "b", "c"], "cs").replace(/\u00a0/g, " ")).toBe("a, b a c");
    expect(formatList(["a"], "cs")).toBe("a");
  });
});
