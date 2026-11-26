"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isValidTimeZone } from "@/features/scheduler/zoned";
import { track } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";
import { DIGEST_SETTINGS_PATH, sendDigestPreview } from "../digest/server/send";
import { digestPrefsOf } from "../digest/schedule";
import { adminCan } from "../roles";
import { logAdminAction } from "./audit";
import { adminAccess } from "./guard";
import { fingerprint } from "./request-info";

/**
 * Administration → Settings → Notifications (30.1): the daily summary of
 * each administrator. Everyone sets their own; the owner and the full
 * administrators the others' too (editDigests). Audited, without addresses.
 */

type Result = { ok: true } | { ok: false; error: "forbidden" | "invalid" | "failed" | "limited" };

const prefsSchema = z.strictObject({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  onlyNews: z.boolean(),
  timeZone: z.string().max(64).nullable(),
});
export type DigestPrefsInput = z.infer<typeof prefsSchema>;

/** Previews a person may send themselves an hour. */
const PREVIEWS_PER_HOUR = 5;

export async function saveDigestPrefs(userId: string, input: DigestPrefsInput): Promise<Result> {
  const parsed = prefsSchema.safeParse(input);
  if (!z.string().uuid().safeParse(userId).success || !parsed.success) return { ok: false, error: "invalid" };
  const prefs = parsed.data;
  if (prefs.timeZone !== null && !isValidTimeZone(prefs.timeZone)) return { ok: false, error: "invalid" };
  const context = await adminAccess(true);
  if (!context) return { ok: false, error: "forbidden" };
  const own = userId === context.userId;
  if (!own && !adminCan(context, "editDigests")) return { ok: false, error: "forbidden" };

  const admin = createAdminClient();
  // Only an administrator has a summary to set.
  const { data: role, error: roleError } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .in("role", ["owner", "admin"])
    .limit(1);
  if (roleError) return { ok: false, error: "failed" };
  if (!role?.length) return { ok: false, error: "invalid" };

  const { data: before } = await admin
    .from("admin_notify_prefs")
    .select("digest_enabled, digest_hour, digest_only_news, digest_time_zone")
    .eq("user_id", userId)
    .maybeSingle();
  const from = digestPrefsOf(before);
  const { error } = await admin.from("admin_notify_prefs").upsert(
    {
      user_id: userId,
      digest_enabled: prefs.enabled,
      digest_hour: prefs.hour,
      digest_only_news: prefs.onlyNews,
      digest_time_zone: prefs.timeZone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("[admin] digest prefs failed", error.message);
    return { ok: false, error: "failed" };
  }
  await logAdminAction(context, "update", "settings.admin_digest", {
    ...(own ? {} : { user: fingerprint("account", userId) }),
    from: { enabled: from.enabled, hour: from.hour, only_news: from.onlyNews, zone: from.timeZone },
    to: { enabled: prefs.enabled, hour: prefs.hour, only_news: prefs.onlyNews, zone: prefs.timeZone },
  });
  await track(
    "admin_digest_prefs_saved",
    { enabled: prefs.enabled, only_news: prefs.onlyNews, hour: prefs.hour, own_zone: prefs.timeZone !== null },
    { userId: context.userId },
  );
  revalidatePath(DIGEST_SETTINGS_PATH);
  return { ok: true };
}

/** Yesterday's summary to the caller, now: to see what it looks like. */
export async function sendDigestPreviewAction(): Promise<Result> {
  const context = await adminAccess(true);
  if (!context) return { ok: false, error: "forbidden" };
  const admin = createAdminClient();
  const { data: people } = await admin.rpc("admin_people", { _ids: [context.userId] });
  const email = people?.[0]?.email;
  if (email) {
    const { count } = await admin
      .from("email_log")
      .select("id", { count: "exact", head: true })
      .eq("kind", "admin_digest")
      .eq("recipient_hash", fingerprint("email", email))
      .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
    if ((count ?? 0) >= PREVIEWS_PER_HOUR) return { ok: false, error: "limited" };
  }
  await logAdminAction(context, "update", "settings.admin_digest.preview");
  try {
    return (await sendDigestPreview(context)) ? { ok: true } : { ok: false, error: "failed" };
  } catch (error) {
    console.error("[admin] digest preview failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "failed" };
  }
}
