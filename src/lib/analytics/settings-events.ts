import type { UserSettings } from "@/lib/user-settings";
import type { EventProps } from "./events";

type SettingEvent = EventProps<"settings_changed">;

/** Values that are codes (a language, a currency, a theme) go along; formats and zones only as "changed". */
const CODE = /^[A-Za-z0-9_.:-]{1,48}$/;

function code(value: unknown): { value?: string } {
  const text = value === null || value === undefined ? "" : String(value);
  return CODE.test(text) ? { value: text } : {};
}

/**
 * The settings a saved patch changed, as analytics events: which setting and
 * the chosen code or switch position — never anything typed.
 */
export function settingsEvents(patch: Partial<UserSettings>): SettingEvent[] {
  const events: SettingEvent[] = [];
  for (const [column, value] of Object.entries(patch)) {
    switch (column) {
      case "locale":
        events.push({ setting: "locale", ...code(value) });
        break;
      case "currency":
        events.push({ setting: "currency", ...code(value) });
        break;
      case "country_code":
        events.push({ setting: "country", ...code(value) });
        break;
      case "timezone":
        events.push({ setting: "timezone" });
        break;
      case "date_format":
        events.push({ setting: "date_format" });
        break;
      case "time_format":
        events.push({ setting: "time_format" });
        break;
      case "number_format":
        events.push({ setting: "number_format", ...code(value) });
        break;
      case "first_day_of_week":
        events.push({ setting: "week_start", ...code(value) });
        break;
      case "theme":
        events.push({ setting: "theme", ...code(value) });
        break;
      case "animations_enabled":
        events.push({ setting: "animations", enabled: value === true });
        break;
      case "sound_enabled":
        events.push({ setting: "sounds", enabled: value === true });
        break;
      case "jarvis_proactive":
        events.push({ setting: "jarvis_proactive", enabled: value === true });
        break;
      case "jarvis_frequency":
        events.push({ setting: "jarvis_frequency", ...code(value) });
        break;
      case "jarvis_quiet_from":
      case "jarvis_quiet_to":
        if (!events.some((event) => event.setting === "jarvis_quiet_hours")) {
          events.push({ setting: "jarvis_quiet_hours", enabled: value !== null });
        }
        break;
      case "reengage_after_months":
        events.push({ setting: "reengage_months", ...code(value) });
        break;
      case "daily_call_goal":
        events.push({ setting: "daily_call_goal", ...code(value) });
        break;
    }
  }
  return events;
}
