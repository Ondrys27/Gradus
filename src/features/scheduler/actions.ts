"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { serverCan } from "@/features/account/server/permissions";
import { isWorkspaceReadOnly } from "@/features/plan/server";
import { measure } from "@/lib/analytics/instrument";
import { track } from "@/lib/analytics/track";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { calendarProvider } from "./analytics";
import { handleCandidates, handleFromName, uniqueSlug } from "./handle";
import {
  activePresetCount,
  DEFAULT_HOURS,
  DEFAULT_WEEKDAYS,
  PRESET_TYPES,
  type PresetKey,
} from "./presets";
import { encryptSecret, hasEncryptionKey } from "./server/crypto";
import { feedTokenHash } from "./server/feed";
import { normalizeIcsUrl } from "./server/ics-fetch";
import { busyWindow, readCalendar, refreshSubscription } from "./server/subscriptions";
import {
  MAX_SUBSCRIPTIONS,
  NAME_MAX,
  PROFILE_COLUMNS,
  SUBSCRIPTION_NAME_MAX,
  TYPE_TONES,
} from "./types";
import { isValidTimeZone } from "./zoned";

/**
 * The scheduler's server side, called from the screens. The user is always
 * the session's; profiles, types and hours are written with the user's own
 * client (RLS and the guards decide), only what is secret goes through the
 * admin client after the check: the encrypted ICS links and the feed token.
 * Failures come back as codes, never thrown.
 */

export type SchedulerActionResult<T> = { ok: true; data: T } | { ok: false; error: SchedulerError };
export type SchedulerError =
  | "unauthenticated"
  | "forbidden"
  | "readOnly"
  | "notConfigured"
  | "invalid"
  | "notHttps"
  | "blocked"
  | "timeout"
  | "tooLarge"
  | "http"
  | "notCalendar"
  | "network"
  | "tooMany"
  | "tooSoon"
  | "notFound"
  | "unknown";

const FETCH_CODES = new Set<SchedulerError>([
  "invalid",
  "blocked",
  "timeout",
  "tooLarge",
  "http",
  "notCalendar",
  "network",
]);

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || !userId) return null;
  return { supabase, userId };
}

function run<T>(name: string, work: () => Promise<SchedulerActionResult<T>>) {
  return measure(`scheduler.${name}`, async (): Promise<SchedulerActionResult<T>> => {
    try {
      return await work();
    } catch (error) {
      console.error(
        `scheduler action ${name} failed`,
        error instanceof Error ? error.name : "unknown",
      );
      return { ok: false, error: "unknown" };
    }
  })();
}

// ---------------------------------------------------------------------------
// First open: the profile, three meeting types and working hours
// ---------------------------------------------------------------------------

const presetNames = z.object({
  intro: z.string().trim().min(1).max(NAME_MAX),
  consultation: z.string().trim().min(1).max(NAME_MAX),
  meeting: z.string().trim().min(1).max(NAME_MAX),
});

/**
 * The person's profile in the active space, made the first time: a handle
 * from their name, their time zone, Monday–Friday 9–17 and the three preset
 * types (as many active as the plan allows). Safe to call again: it only
 * adds what is missing, so a half-finished first run completes.
 */
export async function ensureSchedulerSetup(input: {
  names: Record<PresetKey, string>;
}): Promise<SchedulerActionResult<{ profileId: string; created: boolean }>> {
  return run("setup", async () => {
    const ctx = await session();
    if (!ctx) return { ok: false, error: "unauthenticated" };
    const names = presetNames.safeParse(input.names);
    if (!names.success) return { ok: false, error: "invalid" };
    const { supabase, userId } = ctx;
    const { data: space, error: spaceError } = await supabase.rpc("current_workspace_id");
    if (spaceError || !space) return { ok: false, error: "unknown" };
    if (
      space !== userId &&
      !(await serverCan(supabase, space, "scheduler", "own").catch(() => false))
    ) {
      return { ok: false, error: "forbidden" };
    }

    const existing = await supabase
      .from("scheduler_profiles")
      .select(PROFILE_COLUMNS)
      .eq("user_id", userId)
      .eq("space_id", space)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.setup_done_at)
      return { ok: true, data: { profileId: existing.data.id, created: false } };
    if (await isWorkspaceReadOnly(supabase, space)) return { ok: false, error: "readOnly" };

    let profileId = existing.data?.id ?? null;
    if (!profileId) {
      const [{ data: profile }, { data: settings }] = await Promise.all([
        supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
        supabase.from("user_settings").select("timezone").eq("user_id", userId).maybeSingle(),
      ]);
      const zone =
        settings?.timezone && isValidTimeZone(settings.timezone)
          ? settings.timezone
          : "Europe/Prague";
      const displayName = profile?.display_name?.trim().slice(0, NAME_MAX) || null;
      for (const handle of handleCandidates(handleFromName(displayName), 12)) {
        const { data: available } = await supabase.rpc("scheduler_handle_available", {
          _handle: handle,
        });
        if (!available) continue;
        const inserted = await supabase
          .from("scheduler_profiles")
          .insert({ space_id: space, handle, display_name: displayName, time_zone: zone })
          .select("id")
          .single();
        if (!inserted.error) {
          profileId = inserted.data.id;
          break;
        }
        // Taken a moment ago by someone else: the next candidate.
        if (inserted.error.code !== "23505") throw inserted.error;
      }
      if (!profileId) {
        // Every candidate taken: the database's own placeholder handle, changed in the guide.
        const fallback = await supabase
          .from("scheduler_profiles")
          .insert({ space_id: space, display_name: displayName, time_zone: zone })
          .select("id")
          .single();
        if (fallback.error) throw fallback.error;
        profileId = fallback.data.id;
      }
    }

    const [types, rules] = await Promise.all([
      supabase.from("event_types").select("id").eq("profile_id", profileId).limit(1),
      supabase.from("availability_rules").select("id").eq("profile_id", profileId).limit(1),
    ]);
    if (types.error) throw types.error;
    if (rules.error) throw rules.error;
    if (!rules.data.length) {
      const { error } = await supabase.from("availability_rules").insert(
        DEFAULT_WEEKDAYS.map((weekday) => ({
          profile_id: profileId!,
          weekday,
          start_time: DEFAULT_HOURS.start,
          end_time: DEFAULT_HOURS.end,
        })),
      );
      if (error) throw error;
    }
    if (!types.data.length) {
      const { data: limit } = await supabase.rpc("scheduler_types_limit", { _space: space });
      const active = activePresetCount(typeof limit === "number" ? limit : null);
      const slugs: string[] = [];
      const rows = PRESET_TYPES.map((preset, index) => {
        const slug = uniqueSlug(names.data[preset.key], slugs);
        slugs.push(slug);
        return {
          profile_id: profileId!,
          slug,
          name: names.data[preset.key],
          duration_min: preset.duration,
          location_kind: preset.location,
          position: index,
          active: index < active,
          color: TYPE_TONES[index % TYPE_TONES.length],
        };
      });
      // One by one: the limit counts the active ones already in.
      for (const row of rows) {
        const { error } = await supabase.from("event_types").insert(row);
        if (error) throw error;
      }
    }
    return { ok: true, data: { profileId, created: !existing.data } };
  });
}

// ---------------------------------------------------------------------------
// Subscribed calendars
// ---------------------------------------------------------------------------

const subscriptionInput = z.object({
  name: z.string().trim().min(1).max(SUBSCRIPTION_NAME_MAX),
  color: z.enum(TYPE_TONES),
  url: z.string().trim().min(1).max(2000),
});

/**
 * Adds a calendar by its secret ICS link: checked (https, public host),
 * downloaded once so a wrong link is told at once, then stored encrypted
 * with the busy times. The link never comes back to the browser.
 */
export async function addCalendarSubscription(input: {
  name: string;
  color: string;
  url: string;
}): Promise<SchedulerActionResult<{ id: string; intervals: number }>> {
  return run("subscriptionAdd", async () => {
    const ctx = await session();
    if (!ctx) return { ok: false, error: "unauthenticated" };
    const parsed = subscriptionInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };
    if (!hasEncryptionKey()) {
      console.error("scheduler: INTEGRATIONS_ENCRYPTION_KEY is not set");
      return { ok: false, error: "notConfigured" };
    }
    const normalized = normalizeIcsUrl(parsed.data.url);
    if (!normalized.ok) return { ok: false, error: normalized.reason };

    const admin = createAdminClient();
    const { count, error: countError } = await admin
      .from("calendar_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.userId);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_SUBSCRIPTIONS) return { ok: false, error: "tooMany" };

    const { data: settings } = await ctx.supabase
      .from("user_settings")
      .select("timezone")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const now = Date.now();
    const read = await readCalendar(normalized.url, settings?.timezone ?? "Europe/Prague", now);
    const provider = calendarProvider(normalized.hint);
    if (!read.ok) {
      await track(
        "calendar_subscription_added",
        { provider, ok: false },
        { admin, userId: ctx.userId },
      );
      const code = read.code as SchedulerError;
      return { ok: false, error: FETCH_CODES.has(code) ? code : "network" };
    }
    const { data, error } = await admin
      .from("calendar_subscriptions")
      .insert({
        user_id: ctx.userId,
        name: parsed.data.name,
        color: parsed.data.color,
        url_cipher: encryptSecret(normalized.url),
        url_hint: normalized.hint,
        busy: read.busy as unknown as Json,
        busy_until: new Date(busyWindow(now).to).toISOString(),
        last_fetched_at: new Date(now).toISOString(),
        last_status: "ok",
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "54000") return { ok: false, error: "tooMany" };
      throw error;
    }
    await track(
      "calendar_subscription_added",
      { provider, ok: true },
      { admin, userId: ctx.userId },
    );
    return { ok: true, data: { id: data.id, intervals: read.busy.length } };
  });
}

/** Downloads one of the account's calendars again now (at most once a minute). */
export async function refreshCalendarSubscription(
  id: string,
): Promise<SchedulerActionResult<{ ok: boolean; code: string | null }>> {
  return run("subscriptionRefresh", async () => {
    const ctx = await session();
    if (!ctx) return { ok: false, error: "unauthenticated" };
    if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
    // The account's own, by its own client first.
    const { data: own, error: ownError } = await ctx.supabase
      .from("calendar_subscriptions")
      .select("id, last_fetched_at")
      .eq("id", id)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (ownError) throw ownError;
    if (!own) return { ok: false, error: "notFound" };
    if (own.last_fetched_at && Date.now() - Date.parse(own.last_fetched_at) < 60_000) {
      return { ok: false, error: "tooSoon" };
    }
    if (!hasEncryptionKey()) return { ok: false, error: "notConfigured" };
    const admin = createAdminClient();
    const { data: secret, error } = await admin
      .from("calendar_subscriptions")
      .select("id, user_id, url_cipher")
      .eq("id", id)
      .eq("user_id", ctx.userId)
      .single();
    if (error) throw error;
    const { data: settings } = await ctx.supabase
      .from("user_settings")
      .select("timezone")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const result = await refreshSubscription(admin, secret, settings?.timezone ?? "Europe/Prague");
    await track(
      "calendar_subscription_refreshed",
      result.ok
        ? { ok: true, intervals: Math.min(result.intervals, 5000) }
        : { ok: false, intervals: 0, error_code: result.code },
      { admin, userId: ctx.userId },
    );
    return { ok: true, data: { ok: result.ok, code: result.ok ? null : result.code } };
  });
}

// ---------------------------------------------------------------------------
// The account's own calendar as an ICS feed
// ---------------------------------------------------------------------------

export type FeedState = { active: boolean; createdAt: string | null };

/** Whether the account has a feed link (the link itself is shown only when made). */
export async function calendarFeedState(): Promise<SchedulerActionResult<FeedState>> {
  return run("feedState", async () => {
    const ctx = await session();
    if (!ctx) return { ok: false, error: "unauthenticated" };
    const { data, error } = await createAdminClient()
      .from("calendar_feed_tokens")
      .select("created_at")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (error) throw error;
    return { ok: true, data: { active: Boolean(data), createdAt: data?.created_at ?? null } };
  });
}

/** A new secret feed link; an older one stops working at once. */
export async function createCalendarFeed(): Promise<SchedulerActionResult<{ url: string }>> {
  return run("feedCreate", async () => {
    const ctx = await session();
    if (!ctx) return { ok: false, error: "unauthenticated" };
    const admin = createAdminClient();
    const token = randomBytes(32).toString("base64url");
    const { data: previous } = await admin
      .from("calendar_feed_tokens")
      .select("user_id")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const { error } = await admin.from("calendar_feed_tokens").upsert(
      {
        user_id: ctx.userId,
        token_hash: feedTokenHash(token),
        created_at: new Date().toISOString(),
        last_used_at: null,
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    await track(
      "calendar_feed_created",
      { renewed: Boolean(previous) },
      { admin, userId: ctx.userId },
    );
    return { ok: true, data: { url: `${await siteOrigin()}/api/calendar/feed/${token}.ics` } };
  });
}

/** Switches the feed link off. */
export async function revokeCalendarFeed(): Promise<SchedulerActionResult<null>> {
  return run("feedRevoke", async () => {
    const ctx = await session();
    if (!ctx) return { ok: false, error: "unauthenticated" };
    const { error } = await createAdminClient()
      .from("calendar_feed_tokens")
      .delete()
      .eq("user_id", ctx.userId);
    if (error) throw error;
    return { ok: true, data: null };
  });
}
