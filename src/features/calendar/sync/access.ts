/**
 * Who may connect Google and Apple calendars (28.10). Two-way sync is behind
 * a switch until Google verifies the app: app_settings 'calendar_sync' =
 * `{ mode, allow_created_before, allow_users }`.
 *
 *   * `everyone`: every account.
 *   * `allowlist` (the default): accounts made before `allow_created_before`
 *     (the day this step went out) and the accounts in `allow_users`, added
 *     by hand in Administration → Settings → Integrations.
 *
 * The same rule is `calendar_sync_allowed()` in the database (the server asks
 * it, the guard of calendar_connections asks it again); `validCalendarSync`
 * is `valid_calendar_sync()`. Everyone else keeps the ICS subscriptions.
 */

export const CALENDAR_SYNC_KEY = "calendar_sync";
export const CALENDAR_SYNC_MODES = ["allowlist", "everyone"] as const;
export type CalendarSyncMode = (typeof CALENDAR_SYNC_MODES)[number];

/** The accounts added by hand; a list, not a growth channel. */
export const MAX_ALLOW_USERS = 500;

export type CalendarSyncSetting = {
  mode: CalendarSyncMode;
  /** ISO instant; accounts made before it may connect. Null = nobody by date. */
  allow_created_before: string | null;
  /** Account ids added by hand. */
  allow_users: string[];
};

export const DEFAULT_CALENDAR_SYNC: CalendarSyncSetting = {
  mode: "allowlist",
  allow_created_before: null,
  allow_users: [],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The same pattern as valid_calendar_sync(): a full ISO instant with a zone. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;
const KEYS = new Set(["mode", "allow_created_before", "allow_users"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Strict: what admin_set_app_setting accepts (`valid_calendar_sync()`). */
export function validCalendarSync(value: unknown): value is CalendarSyncSetting {
  if (!isObject(value)) return false;
  if (Object.keys(value).some((key) => !KEYS.has(key))) return false;
  if (!(CALENDAR_SYNC_MODES as readonly unknown[]).includes(value.mode)) return false;
  const before = value.allow_created_before;
  if (before !== null && before !== undefined) {
    if (typeof before !== "string" || !INSTANT.test(before) || !Number.isFinite(Date.parse(before)))
      return false;
  }
  const users = value.allow_users;
  if (users !== undefined) {
    if (!Array.isArray(users) || users.length > MAX_ALLOW_USERS) return false;
    if (!users.every((id) => typeof id === "string" && UUID.test(id))) return false;
    if (new Set(users).size !== users.length) return false;
  }
  return true;
}

/** Lenient: a stored value as the server uses it; anything broken is the default. */
export function parseCalendarSyncSetting(value: unknown): CalendarSyncSetting {
  if (!validCalendarSync(value)) return { ...DEFAULT_CALENDAR_SYNC };
  return {
    mode: value.mode,
    allow_created_before: value.allow_created_before ?? null,
    allow_users: [...(value.allow_users ?? [])],
  };
}

/** Whether an account may connect a calendar (the same as calendar_sync_allowed()). */
export function calendarSyncAllowed(
  setting: CalendarSyncSetting,
  account: { id: string; createdAt: string | null },
): boolean {
  if (setting.mode === "everyone") return true;
  if (setting.allow_users.includes(account.id)) return true;
  if (!setting.allow_created_before || !account.createdAt) return false;
  const created = Date.parse(account.createdAt);
  const before = Date.parse(setting.allow_created_before);
  return Number.isFinite(created) && Number.isFinite(before) && created < before;
}
