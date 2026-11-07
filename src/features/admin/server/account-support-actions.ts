"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliverEmail } from "@/lib/email/e2e-outbox";
import { siteOrigin } from "@/lib/site-origin";
import { authEmail } from "@/features/email/auth-templates";
import { createEmailChangeToken } from "@/features/auth/email-change-token";
import { ADMIN_PATH } from "../access";
import {
  confirmationLink,
  emailChangeLink,
  newEmailSchema,
  recoveryLink,
  SUPPORT_AUDIT_TARGET,
  SUPPORT_EMAIL_ACTIONS,
  SUPPORT_EMAILS_PER_HOUR,
  supportAuditDetail,
  supportReasonSchema,
  type SupportAction,
  type SupportResult,
} from "../account-support";
import { accountSupportBlock } from "../roles";
import { loadAdminRoles } from "./account-data";
import { logAdminAction } from "./audit";
import { adminAccess, type AdminContext } from "./guard";
import { toSiteLocale, type SiteLocale } from "@/lib/routes";

/**
 * The support actions of a user's detail (step 22.1). Owner and admin alike
 * (an admin never for the owner's or another admin's account, nobody for
 * their own); each one needs a reason and is written to admin_audit with it
 * before it happens, so nothing happens unaudited. The links go only into
 * the e-mail to the person's own address (or the new one), never back to
 * the administration and never into the audit.
 */

type Target = {
  context: AdminContext;
  userId: string;
  reason: string;
  email: string | null;
  emailConfirmed: boolean;
  locale: SiteLocale;
};

const userIdSchema = z.uuid();

function secretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return key;
}

/** How many support e-mails this account got in the last hour, from the audit. */
async function emailsInLastHour(userId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count, error } = await createAdminClient()
    .from("admin_audit")
    .select("id", { count: "exact", head: true })
    .in(
      "target",
      SUPPORT_EMAIL_ACTIONS.map((action) => SUPPORT_AUDIT_TARGET[action]),
    )
    .eq("detail->>user", userId)
    .gte("created_at", since);
  if (error) throw new Error(`admin_audit count: ${error.message}`);
  return count ?? 0;
}

/**
 * Everything every action checks first: the input, the session, the account
 * and whether this person may help it, the hourly limit of e-mails, and
 * finally the audit row with the reason.
 */
async function prepare(
  action: SupportAction,
  rawUserId: string,
  rawReason: string,
): Promise<{ ok: true; target: Target } | Extract<SupportResult, { ok: false }>> {
  const userId = userIdSchema.safeParse(rawUserId);
  const reason = supportReasonSchema.safeParse(rawReason);
  if (!userId.success || !reason.success) return { ok: false, error: "invalid" };
  const context = await adminAccess(true);
  if (!context) return { ok: false, error: "forbidden" };

  const admin = createAdminClient();
  const [user, roles, settings] = await Promise.all([
    admin.auth.admin.getUserById(userId.data),
    loadAdminRoles(userId.data),
    admin.from("user_settings").select("locale").eq("user_id", userId.data).maybeSingle(),
  ]);
  const account = user.data.user;
  if (user.error || !account) return { ok: false, error: "notFound" };
  if (accountSupportBlock(context, { id: userId.data, roles })) {
    return { ok: false, error: "blocked" };
  }
  const email = account.email?.trim() || null;
  if (action !== "signOut" && !email) return { ok: false, error: "noEmail" };
  if (action === "confirmation" && account.email_confirmed_at) {
    return { ok: false, error: "notNeeded" };
  }
  if (
    SUPPORT_EMAIL_ACTIONS.includes(action) &&
    (await emailsInLastHour(userId.data)) >= SUPPORT_EMAILS_PER_HOUR
  ) {
    return { ok: false, error: "limit" };
  }
  const metadataLocale = (account.user_metadata as Record<string, unknown> | null)?.locale;
  return {
    ok: true,
    target: {
      context,
      userId: userId.data,
      reason: reason.data,
      email,
      emailConfirmed: Boolean(account.email_confirmed_at),
      locale: toSiteLocale(
        settings.data?.locale ?? (typeof metadataLocale === "string" ? metadataLocale : null),
      ),
    },
  };
}

async function audit(action: SupportAction, target: Target): Promise<boolean> {
  return logAdminAction(
    target.context,
    "update",
    SUPPORT_AUDIT_TARGET[action],
    supportAuditDetail(target.userId, target.reason),
  );
}

function done(userId: string): SupportResult {
  revalidatePath(`${ADMIN_PATH}/uzivatele/${userId}`);
  return { ok: true };
}

/** A link to set a new password, e-mailed to the person (Supabase recovery token, Resend). */
export async function sendPasswordReset(userId: string, reason: string): Promise<SupportResult> {
  const prepared = await prepare("passwordReset", userId, reason);
  if (!prepared.ok) return prepared;
  const { target } = prepared;
  if (!(await audit("passwordReset", target))) return { ok: false, error: "failed" };

  const { data, error } = await createAdminClient().auth.admin.generateLink({
    type: "recovery",
    email: target.email!,
  });
  if (error || !data.properties?.hashed_token) {
    console.error("[admin] recovery link failed", error?.code ?? error?.message);
    return { ok: false, error: "failed" };
  }
  const link = recoveryLink(await siteOrigin(), data.properties.hashed_token, target.locale);
  const sent = await deliverEmail({
    to: target.email!,
    ...authEmail("resetPassword", target.locale, link),
  });
  if (!sent.ok) {
    console.error("[admin] recovery e-mail failed", sent.error);
    return { ok: false, error: "failed" };
  }
  return done(target.userId);
}

/** A new confirmation link for an account that never confirmed its e-mail. */
export async function resendEmailConfirmation(
  userId: string,
  reason: string,
): Promise<SupportResult> {
  const prepared = await prepare("confirmation", userId, reason);
  if (!prepared.ok) return prepared;
  const { target } = prepared;
  if (!(await audit("confirmation", target))) return { ok: false, error: "failed" };

  // A one-time sign-in link: using it confirms the address. A signup link
  // would need the password, which nobody but the person knows.
  const { data, error } = await createAdminClient().auth.admin.generateLink({
    type: "magiclink",
    email: target.email!,
  });
  if (error || !data.properties?.hashed_token) {
    console.error("[admin] confirmation link failed", error?.code ?? error?.message);
    return { ok: false, error: "failed" };
  }
  const link = confirmationLink(await siteOrigin(), data.properties.hashed_token);
  const sent = await deliverEmail({
    to: target.email!,
    ...authEmail("confirmSignup", target.locale, link),
  });
  if (!sent.ok) {
    console.error("[admin] confirmation e-mail failed", sent.error);
    return { ok: false, error: "failed" };
  }
  return done(target.userId);
}

/** Ends every sign-in of the account (a stolen account): it must sign in again everywhere. */
export async function signOutEverywhere(userId: string, reason: string): Promise<SupportResult> {
  const prepared = await prepare("signOut", userId, reason);
  if (!prepared.ok) return prepared;
  const { target } = prepared;
  if (!(await audit("signOut", target))) return { ok: false, error: "failed" };

  const { error } = await createAdminClient().rpc("admin_user_sign_out", {
    _user_id: target.userId,
  });
  if (error) {
    console.error("[admin] sign out everywhere failed", error.code ?? error.message);
    return { ok: false, error: "failed" };
  }
  return done(target.userId);
}

/**
 * Starts a change of the account's e-mail: the new address gets a link, and
 * only its confirmation changes the e-mail (zmena-emailu page). The new
 * address itself is not kept anywhere but in that signed link.
 */
export async function requestEmailChange(
  userId: string,
  newEmail: string,
  reason: string,
): Promise<SupportResult> {
  const parsedEmail = newEmailSchema.safeParse(newEmail);
  if (!parsedEmail.success) return { ok: false, error: "invalid" };
  const prepared = await prepare("emailChange", userId, reason);
  if (!prepared.ok) return prepared;
  const { target } = prepared;
  const next = parsedEmail.data;
  if (next === target.email!.toLowerCase()) return { ok: false, error: "sameEmail" };

  const admin = createAdminClient();
  const { data: taken, error: takenError } = await admin.rpc("admin_email_taken", { _email: next });
  if (takenError) {
    console.error("[admin] e-mail check failed", takenError.code ?? takenError.message);
    return { ok: false, error: "failed" };
  }
  if (taken) return { ok: false, error: "taken" };
  if (!(await audit("emailChange", target))) return { ok: false, error: "failed" };

  const token = createEmailChangeToken(
    { userId: target.userId, oldEmail: target.email!, newEmail: next, requestedBy: target.context.userId },
    secretKey(),
  );
  const link = emailChangeLink(await siteOrigin(), token, target.locale);
  const sent = await deliverEmail({
    to: next,
    ...authEmail("changeEmail", target.locale, link, { oldEmail: target.email!, newEmail: next }),
  });
  if (!sent.ok) {
    console.error("[admin] e-mail change mail failed", sent.error);
    return { ok: false, error: "failed" };
  }
  return done(target.userId);
}
