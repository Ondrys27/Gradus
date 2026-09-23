import { format as formatDateFns } from "date-fns";

/**
 * All user-visible formatting goes through this module.
 * Formats are language-independent: they come from `user_settings`, not from the UI locale.
 * Until user settings are wired in, callers get `DEFAULT_FORMAT_SETTINGS`.
 */
export type FormatSettings = {
  /** BCP 47 locale used only for number grouping and decimal separators. */
  numberLocale: string;
  /** date-fns pattern for calendar dates. */
  dateFormat: string;
  weekStartsOn: 0 | 1;
  /** IANA zone; day boundaries are always computed in the user's zone, never UTC. */
  timeZone: string;
};

export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  numberLocale: "cs-CZ",
  dateFormat: "d. M. yyyy",
  weekStartsOn: 1,
  timeZone: "Europe/Prague",
};

export type NumberFormat = {
  style?: "decimal" | "percent" | "currency";
  /** ISO 4217 code, required for `style: "currency"`. */
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
    currency: style === "currency" ? currency : undefined,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
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

/** Month and year heading in the UI language, e.g. "September 2026" / "září 2026". */
export function formatMonthYear(date: Date, uiLocale: string): string {
  return new Intl.DateTimeFormat(uiLocale, { month: "long", year: "numeric" }).format(date);
}

/** Two-letter weekday label in the UI language. */
export function formatWeekdayShort(date: Date, uiLocale: string): string {
  return new Intl.DateTimeFormat(uiLocale, { weekday: "short" }).format(date);
}
