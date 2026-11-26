import "server-only";
import { fingerprint } from "@/features/admin/server/request-info";
import { serverTranslator } from "@/i18n/server-translator";
import { metricsToday, shiftDay } from "@/lib/analytics/metrics";
import { track } from "@/lib/analytics/track";
import { deliverEmail } from "@/lib/email/e2e-outbox";
import type { IsoDate } from "@/lib/format";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ADMIN_PATH } from "../../access";
import { ADMIN_FORMAT_SETTINGS } from "../../format-metric";
import { adminCan, parseAdminLevel, parseAdminRole, type AdminActor } from "../../roles";
import type { AdminContext } from "../../server/guard";
import { composeDigest, type Translate } from "../compose";
import { hasNews, type DigestFacts } from "../facts";
import { digestPrefsOf, digestSendAt, digestZone, type DigestPrefs } from "../schedule";
import { loadDigestFacts } from "./load-facts";

/**
 * The daily summary to every administrator (30.1). The cron job admin-digest
 * runs once a day before the earliest morning; for each owner and admin it
 * composes yesterday's e-mail and hands it to Resend for their hour
 * (scheduled_at), or sends it at once when that hour has passed. A row in
 * admin_digest_sends per person and day keeps a second run from sending
 * twice. "Send a preview" in the settings sends the caller's own now.
 */

export const DIGEST_SETTINGS_PATH = `${ADMIN_PATH}/upozorneni`;

type Recipient = AdminActor & {
  userId: string;
  email: string;
  locale: string | null;
  accountZone: string | null;
  prefs: DigestPrefs;
};

async function loadRecipients(onlyUserId?: string): Promise<Recipient[]> {
  const admin = createAdminClient();
  let roles = admin.from("user_roles").select("user_id, role, level").in("role", ["owner", "admin"]);
  if (onlyUserId) roles = roles.eq("user_id", onlyUserId);
  const { data, error } = await roles;
  if (error) throw new Error(`user_roles: ${error.message}`);
  const ids = [...new Set((data ?? []).map((row) => row.user_id))];
  if (!ids.length) return [];
  const [people, prefs, settings] = await Promise.all([
    admin.rpc("admin_people", { _ids: ids }),
    admin
      .from("admin_notify_prefs")
      .select("user_id, digest_enabled, digest_hour, digest_only_news, digest_time_zone")
      .in("user_id", ids),
    admin.from("user_settings").select("user_id, locale, timezone").in("user_id", ids),
  ]);
  if (people.error) throw new Error(`admin_people: ${people.error.message}`);
  if (prefs.error) throw new Error(`admin_notify_prefs: ${prefs.error.message}`);
  if (settings.error) throw new Error(`user_settings: ${settings.error.message}`);
  const email = new Map((people.data ?? []).map((row) => [row.user_id, row.email]));
  const pref = new Map((prefs.data ?? []).map((row) => [row.user_id, row]));
  const setting = new Map((settings.data ?? []).map((row) => [row.user_id, row]));
  return (data ?? []).flatMap((row) => {
    const role = parseAdminRole(row.role);
    const address = email.get(row.user_id);
    if (!role || !address) return [];
    return [
      {
        userId: row.user_id,
        role,
        level: parseAdminLevel(role, row.level),
        email: address,
        locale: setting.get(row.user_id)?.locale ?? null,
        accountZone: setting.get(row.user_id)?.timezone ?? null,
        prefs: digestPrefsOf(pref.get(row.user_id)),
      },
    ];
  });
}

/** The owner's view for the loaders that depend on powers; who sees what is decided per e-mail. */
function ownerContext(): AdminContext {
  return { userId: "", role: "owner", level: "full", expiresAt: new Date().toISOString() };
}

export type DigestRun = { day: IsoDate; scheduled: number; sent: number; skipped: number; failed: number };

async function deliver(
  recipient: Recipient,
  facts: DigestFacts,
  origin: string,
  options: { preview: boolean; nowMs: number },
): Promise<"scheduled" | "sent" | "skipped" | "failed"> {
  const audience = { money: adminCan(recipient, "viewMoney") };
  const calmDay = !hasNews(facts, audience);
  const admin = createAdminClient();
  if (!options.preview && recipient.prefs.onlyNews && calmDay) {
    await admin
      .from("admin_digest_sends")
      .insert({ user_id: recipient.userId, day: facts.day, status: "skipped" })
      .then(() => undefined);
    await track(
      "admin_digest_sent",
      { outcome: "skipped", calm: true, money: audience.money, preview: false },
      { userId: recipient.userId },
    );
    return "skipped";
  }
  const scheduledAt = options.preview
    ? null
    : digestSendAt(recipient.prefs.hour, digestZone(recipient.prefs, recipient.accountZone), facts.day, options.nowMs);

  if (!options.preview) {
    // The claim: one summary per person and day, a second run finds the row.
    const { data: claimed, error } = await admin
      .from("admin_digest_sends")
      .upsert(
        { user_id: recipient.userId, day: facts.day, status: scheduledAt ? "scheduled" : "sent", scheduled_for: scheduledAt },
        { onConflict: "user_id,day", ignoreDuplicates: true },
      )
      .select("user_id");
    if (error) throw new Error(`admin_digest_sends: ${error.message}`);
    if (!claimed?.length) return "skipped";
  }

  const t = serverTranslator(recipient.locale) as unknown as Translate;
  const mail = composeDigest({
    facts,
    audience,
    t,
    settings: ADMIN_FORMAT_SETTINGS,
    adminUrl: `${origin}${ADMIN_PATH}`,
    settingsUrl: `${origin}${DIGEST_SETTINGS_PATH}`,
  });
  const result = await deliverEmail({
    kind: "admin_digest",
    to: recipient.email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...(scheduledAt ? { scheduledAt } : {}),
  });
  const outcome = result.ok ? (scheduledAt ? "scheduled" : "sent") : "failed";
  if (!options.preview) {
    await admin
      .from("admin_digest_sends")
      .update({ status: outcome, provider_id: result.ok && result.id && /^[A-Za-z0-9_-]{1,100}$/.test(result.id) ? result.id : null })
      .eq("user_id", recipient.userId)
      .eq("day", facts.day);
  }
  if (!result.ok && result.error !== "internal address") {
    console.error("[admin-digest] e-mail failed", fingerprint("account", recipient.userId), result.error);
  }
  await track(
    "admin_digest_sent",
    { outcome, calm: mail.calm, money: audience.money, preview: options.preview },
    { userId: recipient.userId },
  );
  return outcome;
}

/** The cron job: yesterday's summary to every administrator who wants it. */
export async function runAdminDigest(now: Date = new Date()): Promise<DigestRun> {
  const day = shiftDay(metricsToday(now), -1);
  const run: DigestRun = { day, scheduled: 0, sent: 0, skipped: 0, failed: 0 };
  const recipients = (await loadRecipients()).filter((recipient) => recipient.prefs.enabled);
  if (!recipients.length) return run;
  const [facts, origin] = await Promise.all([loadDigestFacts(day, ownerContext()), siteOrigin()]);
  for (const recipient of recipients) {
    try {
      run[await deliver(recipient, facts, origin, { preview: false, nowMs: now.getTime() })] += 1;
    } catch (error) {
      run.failed += 1;
      console.error("[admin-digest] failed", error instanceof Error ? error.message : "unknown");
    }
  }
  return run;
}

/** "Send me a preview": yesterday's summary to the caller, now, whatever the settings. */
export async function sendDigestPreview(context: AdminContext, now: Date = new Date()): Promise<boolean> {
  const [recipient] = await loadRecipients(context.userId);
  if (!recipient) return false;
  const day = shiftDay(metricsToday(now), -1);
  const [facts, origin] = await Promise.all([loadDigestFacts(day, ownerContext()), siteOrigin()]);
  const outcome = await deliver(recipient, facts, origin, { preview: true, nowMs: now.getTime() });
  return outcome === "sent";
}
