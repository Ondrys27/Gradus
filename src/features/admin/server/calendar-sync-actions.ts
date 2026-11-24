"use server";

import { revalidatePath } from "next/cache";
import {
  CALENDAR_SYNC_KEY,
  MAX_ALLOW_USERS,
  validCalendarSync,
  type CalendarSyncSetting,
} from "@/features/calendar/sync/access";
import {
  clearCalendarSyncSettingCache,
  loadCalendarSyncSetting,
} from "@/features/calendar/sync/server/settings";
import { instantOf } from "@/features/scheduler/zoned";
import { METRICS_TIMEZONE } from "@/lib/analytics/metrics";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_PATH } from "../access";
import { adminAccessFor } from "./guard";
import { fingerprint, requestInfo } from "./request-info";

/**
 * Administration → Settings → Integrations (step 28.10): who may connect a
 * Google or Apple calendar. The owner or a full admin (aal2, live admin
 * session) changes it; the database function checks that again, validates
 * the value (valid_calendar_sync) and audits it in the same transaction.
 */

export type CalendarSyncResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "failed" | "notFound" | "tooMany" | "invalidDate" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_ID = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Reads the current setting fresh, lets `change` alter it, saves through the database function. */
async function update(
  change: (current: CalendarSyncSetting) => CalendarSyncSetting | CalendarSyncResult,
): Promise<CalendarSyncResult> {
  if (!(await adminAccessFor("editCalendarSync"))) return { ok: false, error: "forbidden" };
  clearCalendarSyncSettingCache();
  const current = await loadCalendarSyncSetting();
  const next = change(current);
  if ("ok" in next) return next;
  if (!validCalendarSync(next)) return { ok: false, error: "failed" };
  const { ip } = await requestInfo();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_app_setting", {
    _key: CALENDAR_SYNC_KEY,
    _value: next,
    _ip_hash: fingerprint("ip", ip),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    console.error("[admin] saving the calendar sync setting failed", error.message);
    return { ok: false, error: "failed" };
  }
  clearCalendarSyncSettingCache();
  revalidatePath(`${ADMIN_PATH}/integrace`);
  return { ok: true };
}

export async function setCalendarSyncMode(everyone: boolean): Promise<CalendarSyncResult> {
  if (typeof everyone !== "boolean") return { ok: false, error: "failed" };
  return update((current) => ({ ...current, mode: everyone ? "everyone" : "allowlist" }));
}

/** `day` is a calendar day (YYYY-MM-DD) in the administration's zone, or null for "nobody by date". */
export async function setCalendarSyncDate(day: string | null): Promise<CalendarSyncResult> {
  let instant: string | null = null;
  if (day !== null) {
    const match = typeof day === "string" ? DAY.exec(day) : null;
    if (!match) return { ok: false, error: "invalidDate" };
    const probe = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (probe.getUTCMonth() !== Number(match[2]) - 1) return { ok: false, error: "invalidDate" };
    const ms = instantOf(
      { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: 0, minute: 0 },
      METRICS_TIMEZONE,
    );
    if (!Number.isFinite(ms)) return { ok: false, error: "invalidDate" };
    instant = new Date(ms).toISOString();
  }
  return update((current) => ({ ...current, allow_created_before: instant }));
}

/** Resolves an e-mail, a short public ID or an account id to an account id; null when none matches. */
async function resolveAccount(query: string): Promise<string | null> {
  const value = query.trim();
  if (!value) return null;
  const admin = createAdminClient();
  if (UUID.test(value)) {
    const { data } = await admin.rpc("admin_people", { _ids: [value.toLowerCase()] });
    return data?.[0]?.user_id ?? null;
  }
  if (value.includes("@")) {
    const { data } = await admin.rpc("account_by_email", { _email: value });
    return typeof data === "string" && data ? data : null;
  }
  const publicId = value.toUpperCase();
  if (PUBLIC_ID.test(publicId)) {
    const { data } = await admin.rpc("account_by_public_id", { _public_id: publicId });
    return typeof data === "string" && data ? data : null;
  }
  return null;
}

export async function addCalendarSyncAccount(query: string): Promise<CalendarSyncResult> {
  if (typeof query !== "string" || query.length > 200) return { ok: false, error: "failed" };
  if (!(await adminAccessFor("editCalendarSync"))) return { ok: false, error: "forbidden" };
  const id = await resolveAccount(query);
  if (!id) return { ok: false, error: "notFound" };
  return update((current) => {
    if (current.allow_users.includes(id)) return current;
    if (current.allow_users.length >= MAX_ALLOW_USERS) return { ok: false, error: "tooMany" };
    return { ...current, allow_users: [...current.allow_users, id] };
  });
}

export async function removeCalendarSyncAccount(id: string): Promise<CalendarSyncResult> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "failed" };
  return update((current) => ({
    ...current,
    allow_users: current.allow_users.filter((existing) => existing !== id),
  }));
}
