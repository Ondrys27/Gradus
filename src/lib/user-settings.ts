import type { Database } from "@/types/database";
import {
  DATE_FORMATS,
  DEFAULT_FORMAT_SETTINGS,
  NUMBER_FORMATS,
  TIME_FORMATS,
  WEEK_STARTS,
  type FormatSettings,
  type NumberFormatKey,
  type WeekStart,
} from "./format";
import { isValidTimeZone } from "./region";

export type UserSettings = Database["public"]["Tables"]["user_settings"]["Row"];
export type UserSettingsPatch = Partial<
  Pick<
    UserSettings,
    | "locale"
    | "timezone"
    | "country_code"
    | "currency"
    | "date_format"
    | "time_format"
    | "number_format"
    | "first_day_of_week"
    | "sound_enabled"
    | "animations_enabled"
  >
>;

/** Columns the app reads; never `select *`. */
export const USER_SETTINGS_COLUMNS =
  "id, user_id, locale, timezone, country_code, currency, date_format, time_format, number_format, first_day_of_week, sound_enabled, animations_enabled, daily_call_goal, created_at, updated_at" as const;

/** The database row is the source of truth; anything unknown falls back to the defaults. */
export function toFormatSettings(row: UserSettings | null | undefined): FormatSettings {
  if (!row) return DEFAULT_FORMAT_SETTINGS;
  const numberLocale =
    NUMBER_FORMATS[row.number_format as NumberFormatKey] ?? DEFAULT_FORMAT_SETTINGS.numberLocale;
  return {
    numberLocale,
    dateFormat: (DATE_FORMATS as readonly string[]).includes(row.date_format)
      ? row.date_format
      : DEFAULT_FORMAT_SETTINGS.dateFormat,
    timeFormat: (TIME_FORMATS as readonly string[]).includes(row.time_format)
      ? row.time_format
      : DEFAULT_FORMAT_SETTINGS.timeFormat,
    weekStartsOn: (WEEK_STARTS as readonly number[]).includes(row.first_day_of_week)
      ? (row.first_day_of_week as WeekStart)
      : DEFAULT_FORMAT_SETTINGS.weekStartsOn,
    currency: /^[A-Z]{3}$/.test(row.currency) ? row.currency : DEFAULT_FORMAT_SETTINGS.currency,
    timeZone: isValidTimeZone(row.timezone) ? row.timezone : DEFAULT_FORMAT_SETTINGS.timeZone,
  };
}
