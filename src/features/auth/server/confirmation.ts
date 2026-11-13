import "server-only";
import { confirmationLink } from "@/features/admin/account-support";
import { authEmail } from "@/features/email/auth-templates";
import { deliverEmail } from "@/lib/email/e2e-outbox";
import { toSiteLocale } from "@/lib/routes";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";

/** A new link at most this often per account (the form's "Send again"). */
export const CONFIRMATION_RESEND_MS = 60_000;

export type ConfirmationResult = { ok: true } | { ok: false; reason: "rateLimited" | "failed" };

/**
 * The e-mail that confirms a new account's address, in Gradus's template
 * and the person's language (27.1; Supabase's own e-mail came in English).
 * A one-time sign-in link: using it confirms the address, like the
 * administration's "Send the confirmation again". Only for an account that
 * exists and has not confirmed yet; anything else quietly sends nothing.
 */
export async function sendSignupConfirmation(
  email: string,
  locale: string | null | undefined,
  now: number = Date.now(),
): Promise<ConfirmationResult> {
  const admin = createAdminClient();
  const { data: userId, error: findError } = await admin.rpc("account_by_email", { _email: email });
  if (findError) return { ok: false, reason: "failed" };
  if (!userId) return { ok: true };
  const { data: found, error: userError } = await admin.auth.admin.getUserById(userId);
  const user = found?.user;
  if (userError || !user?.email) return { ok: false, reason: "failed" };
  if (user.email_confirmed_at) return { ok: true };

  const last = Date.parse(String(user.app_metadata?.confirmation_mail_at ?? ""));
  if (Number.isFinite(last) && now - last < CONFIRMATION_RESEND_MS) {
    return { ok: false, reason: "rateLimited" };
  }
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  if (error || !data.properties?.hashed_token) {
    console.error("[auth] confirmation link failed", error?.code ?? error?.message);
    return { ok: false, reason: "failed" };
  }
  const language = toSiteLocale(locale ?? (user.user_metadata?.locale as string | undefined));
  const link = confirmationLink(await siteOrigin(), data.properties.hashed_token);
  const sent = await deliverEmail({ to: user.email, ...authEmail("confirmSignup", language, link) });
  if (!sent.ok) {
    console.error("[auth] confirmation e-mail failed", sent.error);
    return { ok: false, reason: "failed" };
  }
  // app_metadata is the server's: the person can not reset the pause.
  await admin.auth.admin
    .updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, confirmation_mail_at: new Date(now).toISOString() },
    })
    .catch(() => null);
  return { ok: true };
}
