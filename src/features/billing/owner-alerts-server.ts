import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_PATH } from "@/features/admin/access";
import { ADMIN_FORMAT_SETTINGS } from "@/features/admin/format-metric";
import { ownerContact } from "@/features/jarvis/server/owner";
import { planName } from "@/features/plan/catalog";
import { getPublishedPlans } from "@/features/plan/catalog-server";
import { serverTranslator } from "@/i18n/server-translator";
import { APP_NAME } from "@/lib/constants";
import { escapeHtml, sendEmail } from "@/lib/email/resend";
import type { Database } from "@/types/database";
import type { OwnerAlert } from "./stripe/webhook";
import { ownerDigest, type OwnerAlertRow } from "./owner-alerts";

/**
 * The owner's digest of payments, on the server: the webhook records an
 * alert (billing_alert_add, once per invoice or subscription) and tries to
 * send at once; billing_alerts_claim() lets one e-mail out a day (in the
 * metrics' zone) and holds the rest for the next one, which the daily cron
 * sends at the latest. A failed e-mail gives its alerts back.
 */

type Admin = SupabaseClient<Database>;

/** Records one alert; a failure is only logged (the webhook goes on). */
export async function recordOwnerAlert(admin: Admin, alert: OwnerAlert): Promise<boolean> {
  const { data, error } = await admin.rpc("billing_alert_add", {
    _kind: alert.kind,
    _user_id: alert.workspace,
    _mode: alert.mode,
    _ref: alert.ref,
    ...(alert.planKey ? { _plan_key: alert.planKey } : {}),
    ...(alert.billing ? { _billing: alert.billing } : {}),
    ...(alert.kind === "first_payment" ? { _amount: alert.amount, _currency: alert.currency } : {}),
  });
  if (error) {
    console.error("[billing] owner alert not recorded", error.code ?? error.message);
    return false;
  }
  return data === true;
}

async function emailsOf(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data.user?.email) out.set(id, data.user.email);
    }),
  );
  return out;
}

export type DigestOutcome = "sent" | "nothing" | "failed";

/** Sends what is waiting, unless a digest went out today. Never throws. */
export async function sendOwnerDigest(admin: Admin): Promise<DigestOutcome> {
  let claimed: string[] = [];
  try {
    const { data, error } = await admin.rpc("billing_alerts_claim", {
      _tz: ADMIN_FORMAT_SETTINGS.timeZone,
    });
    if (error) throw new Error(error.code ?? error.message);
    const alerts: OwnerAlertRow[] = (data ?? []).map((row) => ({
      id: row.id,
      kind: row.kind === "final_failure" ? "final_failure" : "first_payment",
      userId: row.user_id,
      mode: row.stripe_mode === "live" ? "live" : "test",
      planKey: row.plan_key,
      billing: row.billing === "yearly" ? "yearly" : row.billing === "monthly" ? "monthly" : null,
      amount: row.amount === null ? null : Number(row.amount),
      currency: row.currency,
      createdAt: row.created_at,
    }));
    claimed = alerts.map((alert) => alert.id);
    if (alerts.length === 0) return "nothing";

    const [owner, plans, emails] = await Promise.all([
      ownerContact(admin),
      getPublishedPlans(),
      emailsOf(admin, alerts.map((alert) => alert.userId)),
    ]);
    if (!owner.email) throw new Error("no owner e-mail");
    const t = serverTranslator(owner.locale);
    const locale = owner.locale === "en" ? "en" : "cs";
    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || null;
    const mail = ownerDigest({
      alerts,
      who: (id) => emails.get(id) ?? id,
      planName: (key) => planName(plans, key, locale) ?? key,
      adminUrl: (id) => (site ? `${site}${ADMIN_PATH}/uzivatele/${id}` : null),
      t: (key, values) => t(key as never, values as never),
      settings: ADMIN_FORMAT_SETTINGS,
      appName: APP_NAME,
    });
    if (!mail) return "nothing";
    const sent = await sendEmail({
      to: owner.email,
      subject: mail.subject,
      text: mail.lines.join("\n"),
      html: mail.lines
        .filter((line) => line !== "")
        .map((line) => `<p>${escapeHtml(line).replace(/\n/g, "<br>")}</p>`)
        .join("\n"),
    });
    if (!sent.ok) throw new Error(sent.error);
    return "sent";
  } catch (error) {
    console.error("[billing] owner digest failed", error instanceof Error ? error.message : "unknown");
    if (claimed.length) {
      const { error: releaseError } = await admin.rpc("billing_alerts_release", { _ids: claimed });
      if (releaseError) console.error("[billing] owner digest release failed", releaseError.code);
    }
    return "failed";
  }
}
