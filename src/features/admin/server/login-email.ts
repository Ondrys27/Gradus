import "server-only";
import { serverTranslator } from "@/i18n/server-translator";
import { browserOf, deviceOf } from "@/lib/analytics/device";
import { APP_NAME } from "@/lib/constants";
import { escapeHtml, sendEmail } from "@/lib/email/resend";
import { formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { toFormatSettings, USER_SETTINGS_COLUMNS } from "@/lib/user-settings";

/**
 * Tells the owner about every sign-in to the administration: when, from what
 * device and the address fingerprint. A sign-in they did not make is their
 * signal to change the password at once.
 */
export async function sendAdminLoginEmail(input: {
  userId: string;
  email: string;
  userAgent: string | null;
  ipHash: string;
  at?: Date;
}): Promise<void> {
  const { data: settings, error } = await createAdminClient()
    .from("user_settings")
    .select(USER_SETTINGS_COLUMNS)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error) console.error("[admin] settings for the sign-in e-mail failed", error.message);

  const t = serverTranslator(settings?.locale);
  const values = {
    appName: APP_NAME,
    time: formatDateTime(input.at ?? new Date(), toFormatSettings(settings)),
    device: t("admin.loginEmail.deviceValue", {
      browser: t(`admin.browser.${browserOf(input.userAgent)}`),
      device: t(`admin.device.${deviceOf(input.userAgent)}`),
    }),
    ip: input.ipHash,
  };
  const lines = [
    t("admin.loginEmail.intro", values),
    t("admin.loginEmail.time", values),
    t("admin.loginEmail.device", values),
    t("admin.loginEmail.ip", values),
    t("admin.loginEmail.notYou", values),
  ];
  const sent = await sendEmail({
    to: input.email,
    subject: t("admin.loginEmail.subject", values),
    text: [lines[0], "", lines[1], lines[2], lines[3], "", lines[4]].join("\n"),
    html: `<p>${escapeHtml(lines[0])}</p>
<p>${escapeHtml(lines[1])}<br>${escapeHtml(lines[2])}<br>${escapeHtml(lines[3])}</p>
<p>${escapeHtml(lines[4])}</p>`,
  });
  if (!sent.ok) console.error("[admin] sign-in e-mail failed", sent.error);
}
