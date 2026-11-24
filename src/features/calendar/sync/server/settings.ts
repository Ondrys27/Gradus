import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import {
  CALENDAR_SYNC_KEY,
  DEFAULT_CALENDAR_SYNC,
  parseCalendarSyncSetting,
  type CalendarSyncSetting,
} from "../access";

type Admin = SupabaseClient<Database>;

/**
 * The switch of two-way calendar sync (app_settings 'calendar_sync'), read
 * by the server only and kept 30 seconds per instance like the other
 * settings; the instance that saved a change forgets its copy at once.
 */
const TTL_MS = 30_000;
let cache: { at: number; value: CalendarSyncSetting } | null = null;

export function clearCalendarSyncSettingCache() {
  cache = null;
}

export async function loadCalendarSyncSetting(
  admin: Admin = createAdminClient(),
  now = Date.now(),
): Promise<CalendarSyncSetting> {
  if (cache && now - cache.at <= TTL_MS) return cache.value;
  const { data, error } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", CALENDAR_SYNC_KEY)
    .maybeSingle();
  if (error) {
    // A failed read lets nobody new in; it is never a reason to open the gate.
    console.error("[calendar-sync] reading the switch failed", error.code);
    return { ...DEFAULT_CALENDAR_SYNC };
  }
  const value = parseCalendarSyncSetting(data?.value);
  cache = { at: now, value };
  return value;
}

/**
 * Whether the account may connect Google or Apple: the database decides
 * (`calendar_sync_allowed`, the same rule its guard checks), so a direct
 * call never gets further than the screen.
 */
export async function isCalendarSyncAllowed(admin: Admin, userId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("calendar_sync_allowed", { _user: userId });
  if (error) {
    console.error("[calendar-sync] access check failed", error.code);
    return false;
  }
  return data === true;
}
