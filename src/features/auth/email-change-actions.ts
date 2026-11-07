"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { EMAIL_CHANGE_CONFIRMED_TARGET } from "@/features/admin/account-support";
import { fingerprint, requestInfo } from "@/features/admin/server/request-info";
import { emailChangeStillApplies, readEmailChangeToken } from "./email-change-token";

export type EmailChangeOutcome =
  | { ok: true; email: string }
  | { ok: false; error: "invalid" | "taken" | "failed" };

/**
 * The new address confirms the change the administration started: a genuine,
 * unexpired link for an account that still has the old address changes its
 * e-mail (confirmed, since the link reached the new address). Any other link
 * gets the same neutral answer. Called from the page in the browser, so a
 * mail scanner that only fetches the link changes nothing.
 */
export async function confirmEmailChange(token: string): Promise<EmailChangeOutcome> {
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || typeof token !== "string") return { ok: false, error: "invalid" };
  const claim = readEmailChangeToken(token, secret);
  if (!claim) return { ok: false, error: "invalid" };

  const admin = createAdminClient();
  const { data: user, error: readError } = await admin.auth.admin.getUserById(claim.userId);
  if (readError || !user.user || !emailChangeStillApplies(claim, user.user.email)) {
    return { ok: false, error: "invalid" };
  }
  const { error } = await admin.auth.admin.updateUserById(claim.userId, {
    email: claim.newEmail,
    email_confirm: true,
  });
  if (error) {
    if (error.code === "email_exists" || error.status === 422) return { ok: false, error: "taken" };
    console.error("[auth] e-mail change failed", error.code ?? error.message);
    return { ok: false, error: "failed" };
  }

  // In the audit next to the request, under the administrator who asked.
  const { ip } = await requestInfo();
  const { error: auditError } = await admin.from("admin_audit").insert({
    user_id: claim.requestedBy,
    kind: "update",
    target: EMAIL_CHANGE_CONFIRMED_TARGET,
    ip_hash: fingerprint("ip", ip),
    detail: { user: claim.userId },
  });
  if (auditError) console.error("[auth] e-mail change audit failed", auditError.message);
  return { ok: true, email: claim.newEmail };
}
