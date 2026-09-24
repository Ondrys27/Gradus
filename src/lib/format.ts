import { format as formatDateFns } from "date-fns";

/**
 * All user-visible formatting goes through this module.
 * Formats are language-independent: they come from `user_settings`, not from the UI locale.
 * Signed-in screens read them with `useFormatSettings()`; without a user the defaults apply.
 */

/** Number styles offered in settings, stored in `user_settings.number_format`. */
export const NUMBER_FORMATS = {
  cs: "cs-CZ", // 1 234 567,89
  en: "en-US", // 1,234,567.89
  de: "de-DE", // 1.234.567,89
  fr: "fr-FR", // 1 234 567,89 (narrow spaces)
  ch: "de-CH", // 1’234’567.89
} as const;
export type NumberFormatKey = keyof typeof NUMBER_FORMATS;

/** date-fns patterns offered in settings, stored in `user_settings.date_format`. */
export const DATE_FORMATS = [
  "d. M. yyyy",
  "dd.MM.yyyy",
  "dd/MM/yyyy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** date-fns patterns offered in settings, stored in `user_settings.time_format`. */
export const TIME_FORMATS = ["HH:mm", "h:mm a"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

/** Monday, Sunday, Saturday — stored in `user_settings.first_day_of_week` (0 = Sunday). */
export const WEEK_STARTS = [1, 0, 6] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];

/** Currencies offered in settings. Display only: amounts are never converted. */
export const CURRENCIES = [
  "CZK",
  "EUR",
  "USD",
  "GBP",
  "PLN",
  "HUF",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "RON",
  "BGN",
  "UAH",
  "TRY",
  "CAD",
  "AUD",
  "NZD",
  "JPY",
  "CNY",
  "INR",
  "BRL",
  "MXN",
  "ZAR",
  "AED",
] as const;

export type FormatSettings = {
  /** BCP 47 locale used only for number grouping and decimal separators. */
  numberLocale: string;
  /** date-fns pattern for calendar dates. */
  dateFormat: string;
  /** date-fns pattern for clock times. */
  timeFormat: string;
  weekStartsOn: WeekStart;
  /** ISO 4217 code for money. Changes only how amounts are shown, never converts them. */
  currency: string;
  /** IANA zone; day boundaries are always computed in the user's zone, never UTC. */
  timeZone: string;
};

export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  numberLocale: "cs-CZ",
  dateFormat: "d. M. yyyy",
  timeFormat: "HH:mm",
  weekStartsOn: 1,
  currency: "CZK",
  timeZone: "Europe/Prague",
};

export type NumberFormat = {
  style?: "decimal" | "percent" | "currency";
  /** ISO 4217 code for `style: "currency"`; defaults to the user's currency. */
  currency?: string;
  decimals?: number;
};

export function formatNumber(
  value: number,
  options: NumberFormat = {},
  settings: FormatSettings = DEFAULT_FORMAT_SETTINGS,
): string {
  const { style = "decimal", currency, decimals = 0 } = options;
  return new Intl.NumberFormat(settings.numberLocale, {
    style,
    currency: style === "currency" ? (currency ?? settings.currency) : undefined,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Money in the user's number format. Never converts: `currency` only picks the symbol. */
export function formatCurrency(
  value: number,
  currency?: string,
  settings: FormatSettings = DEFAULT_FORMAT_SETTINGS,
  decimals = 0,
): string {
  return formatNumber(value, { style: "currency", currency, decimals }, settings);
}

/** Calendar date (no time, no time zone) as `yyyy-MM-dd`. */
export type IsoDate = string;

export function isoDateToLocal(value: IsoDate): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function localToIsoDate(date: Date): IsoDate {
  return formatDateFns(date, "yyyy-MM-dd");
}

/** Today's calendar date in the user's time zone. */
export function todayIsoDate(
  settings: FormatSettings = DEFAULT_FORMAT_SETTINGS,
  now: Date = new Date(),
): IsoDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatCalendarDate(
  value: IsoDate,
  settings: FormatSettings = DEFAULT_FORMAT_SETTINGS,
): string {
  return formatDateFns(isoDateToLocal(value), settings.dateFormat);
}

/** Day number inside a calendar grid. */
export function formatDayOfMonth(
  date: Date,
  settings: FormatSettings = DEFAULT_FORMAT_SETTINGS,
): string {
  return formatNumber(date.getDate(), {}, settings);
}

/** Month and year heading in the UI language, e.g. "September 2026" / "září 2026". */
export function formatMonthYear(date: Date, uiLocale: string): string {
  return new Intl.DateTimeFormat(uiLocale, { month: "long", year: "numeric" }).format(date);
}

/** Two-letter weekday label in the UI language. */
export function formatWeekdayShort(date: Date, uiLocale: string): string {
  return new Intl.DateTimeFormat(uiLocale, { weekday: "short" }).format(date);
}

/**
 * Wall-clock reading of an instant in the user's zone, as a local `Date` that
 * date-fns can format. Only for display; never send it back to the database.
 */
export function toZonedWallClock(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return new Date(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
}

/** Date of an instant (timestamptz) in the user's zone. */
export function formatDate(
  instant: Date,
  settings: FormatSettings = DEFAULT_FORMAT_SETTINGS,
): string {
  return formatDateFns(toZonedWallClock(instant, settings.timeZone), settings.dateFormat);
}

/** Clock time of an instant in the user's zone. */
export function formatTime(
  instant: Date,
  settings: FormatSettings = DEFAULT_FORMAT_SETTINGS,
): string {
  return formatDateFns(toZonedWallClock(instant, settings.timeZone), settings.timeFormat);
}

export function formatDateTime(
  instant: Date,
  settings: FormatSettings = DEFAULT_FORMAT_SETTINGS,
): string {
  return `${formatDate(instant, settings)} ${formatTime(instant, settings)}`;
}

/** Full weekday name in the UI language, e.g. "Monday" / "pondělí". */
export function formatWeekdayLong(date: Date, uiLocale: string): string {
  return new Intl.DateTimeFormat(uiLocale, { weekday: "long" }).format(date);
}

/** Weekday name for a day number (0 = Sunday) in the UI language. */
export function weekdayName(day: number, uiLocale: string): string {
  // 2023-01-01 was a Sunday.
  return formatWeekdayLong(new Date(2023, 0, 1 + day), uiLocale);
}

/** Country name in the UI language, e.g. "Czechia" / "Česko". */
export function countryName(code: string, uiLocale: string): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Currency name in the UI language, e.g. "Czech Koruna" / "česká koruna". */
export function currencyName(code: string, uiLocale: string): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Offset label for a time zone at a given moment, e.g. "GMT+2". */
export function timeZoneOffsetLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
