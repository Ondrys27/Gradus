"use server";

import { createHash, randomBytes } from "node:crypto";
import { getLocale } from "next-intl/server";
import { serverTranslator } from "@/i18n/server-translator";
import { APP_NAME } from "@/lib/constants";
import { escapeHtml, sendEmail } from "@/lib/email/resend";
import { toSiteLocale, localizedPath } from "@/lib/routes";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  mayResend,
  WAITLIST_UNCONFIRMED_DAYS,
  waitlistError,
  waitlistSchema,
  type WaitlistState,
} from "./waitlist";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Puts an e-mail on the waitlist and sends the confirmation link. The table is
 * server-only. Always answers the same way whether the address was new,
 * waiting or confirmed, so the form cannot tell who signed up.
 */
export async function joinWaitlist(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const parsed = waitlistSchema.safeParse(Object.fromEntries(formData));
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: waitlistError(parsed.error), email };
  // A bot filled in the hidden field: pretend all went well.
  if (parsed.data.website) return { ok: true };

  const locale = toSiteLocale(await getLocale());
  const admin = createAdminClient();

  // Addresses nobody confirmed are not kept.
  const cutoff = new Date(Date.now() - WAITLIST_UNCONFIRMED_DAYS * 86_400_000).toISOString();
  await admin.from("waitlist").delete().is("confirmed_at", null).lt("created_at", cutoff);

  const { data: existing, error: readError } = await admin
    .from("waitlist")
    .select("id, confirmed_at, confirm_sent_at")
    .eq("email", parsed.data.email)
    .maybeSingle();
  if (readError) {
    console.error("[waitlist] read failed", readError);
    return { error: "generic", email };
  }
  if (existing?.confirmed_at || (existing && !mayResend(existing.confirm_sent_at))) {
    return { ok: true };
  }

  const token = randomBytes(32).toString("base64url");
  const row = {
    email: parsed.data.email,
    locale,
    source: parsed.data.source,
    confirm_token_hash: hashToken(token),
    confirm_sent_at: new Date().toISOString(),
  };
  const write = existing
    ? await admin.from("waitlist").update(row).eq("id", existing.id)
    : await admin.from("waitlist").insert(row);
  if (write.error) {
    // Two submits at once: the other one sends the e-mail.
    if (write.error.code === "23505") return { ok: true };
    console.error("[waitlist] write failed", write.error);
    return { error: "generic", email };
  }

  const link = `${await siteOrigin()}${localizedPath("waitlistConfirmed", locale)}?token=${token}`;
  const t = serverTranslator(locale);
  const values = { appName: APP_NAME };
  const sent = await sendEmail({
    to: parsed.data.email,
    subject: t("marketing.waitlistEmail.subject", values),
    text: [
      t("marketing.waitlistEmail.intro", values),
      "",
      link,
      "",
      t("marketing.waitlistEmail.ignore"),
    ].join("\n"),
    html: `<p>${escapeHtml(t("marketing.waitlistEmail.intro", values))}</p>
<p><a href="${escapeHtml(link)}">${escapeHtml(t("marketing.waitlistEmail.button"))}</a></p>
<p>${escapeHtml(t("marketing.waitlistEmail.ignore"))}</p>`,
  });
  if (!sent.ok) {
    console.error("[waitlist] confirmation e-mail failed", sent.error);
    // Let the visitor try again at once.
    await admin.from("waitlist").update({ confirm_sent_at: null }).eq("email", parsed.data.email);
    return { error: "generic", email };
  }
  return { ok: true };
}

/** The link from the e-mail: sets confirmed_at once, then the token is gone. */
export async function confirmWaitlist(token: string): Promise<{ ok: boolean }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false };
  const { data, error } = await createAdminClient()
    .from("waitlist")
    .update({ confirmed_at: new Date().toISOString(), confirm_token_hash: null })
    .eq("confirm_token_hash", hashToken(token))
    .is("confirmed_at", null)
    .select("id");
  if (error) {
    console.error("[waitlist] confirm failed", error);
    return { ok: false };
  }
  return { ok: data.length === 1 };
}
