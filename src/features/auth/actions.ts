"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { isFreshRecoverySession } from "@/lib/auth/recovery";
import { HOME_PATH, loginPath, safeNextPath } from "@/lib/auth/routes";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/i18n/locale-cookie";
import { localizedPath } from "@/lib/routes";
import { locales, type Locale } from "@/i18n/locales";
import {
  countryFromTimeZone,
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  regionFormats,
} from "@/lib/region";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isPublicSignupEnabled } from "@/lib/signup";
import { inviteEmailMatches, isValidInviteCode } from "./invite-code";
import { decideSignup } from "./signup-mode";
import { findOpenWorkerInvite, type OpenWorkerInvite } from "./worker-invite";
import {
  authErrorKey,
  fieldErrorsFrom,
  forgotPasswordSchema,
  newPasswordSchema,
  signInSchema,
  signUpSchema,
  type FormState,
} from "./schemas";

async function setLocaleCookie(locale: string) {
  if (!locales.includes(locale as Locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
}

/** The UI language follows `user_settings.locale` from the moment of sign-in. */
async function syncLocaleFromSettings(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_settings")
    .select("locale")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.locale) await setLocaleCookie(data.locale);
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  const values = { email: String(formData.get("email") ?? "") };
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) return { error: authErrorKey(error), values };

  await syncLocaleFromSettings(data.user.id);
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

/**
 * Accounts are created only here (sign-ups are disabled in Supabase). With an
 * invite code (beta or a worker invite) the account gets beta; without one,
 * and only when PUBLIC_SIGNUP_ENABLED is on, a 14-day trial, which the
 * database starts for every new account by itself.
 * E-mail confirmation is off for the beta; turn it on before launch.
 */
export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  const values = {
    displayName: String(formData.get("displayName") ?? ""),
    email: String(formData.get("email") ?? ""),
    inviteCode: String(formData.get("inviteCode") ?? ""),
  };
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const code = parsed.data.inviteCode;
  const expected = process.env.INVITE_CODE;
  const betaCodeMatches = Boolean(code) && isValidInviteCode(code, expected);
  let workerInvite: OpenWorkerInvite | null = null;
  if (code && !betaCodeMatches) {
    workerInvite = await findOpenWorkerInvite(code).catch((error) => {
      console.error("[auth] worker invite lookup failed", error);
      return null;
    });
  }
  const decision = decideSignup({
    code,
    betaCodeMatches,
    workerInviteFound: Boolean(workerInvite),
    betaCodeConfigured: Boolean(expected),
    publicSignup: isPublicSignupEnabled(),
  });
  if (decision.kind === "error") {
    return decision.field
      ? { fieldErrors: { [decision.field]: decision.error }, values }
      : { error: decision.error, values };
  }
  if (workerInvite && !inviteEmailMatches(workerInvite.email, parsed.data.email)) {
    return { fieldErrors: { email: "inviteEmailMismatch" }, values };
  }

  const locale = await getLocale();
  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { locale },
  });
  if (createError || !created.user) {
    const key = authErrorKey(createError);
    if (key === "emailTaken") return { fieldErrors: { email: key }, values };
    if (key === "weakPassword") return { fieldErrors: { password: key }, values };
    console.error("[auth] createUser failed", createError);
    return { error: key, values };
  }

  // The database trigger has created profile, settings and role. Fill in what the browser told us.
  const userId = created.user.id;

  const rollback = async (what: string, error: unknown) => {
    console.error(`[auth] ${what} failed`, error);
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) console.error("[auth] rollback of new account failed", deleteError);
  };

  // A worker's account is bound to the owner's worker record, or not created at all.
  if (decision.kind === "worker") {
    const { error: acceptError } = await admin.rpc("accept_worker_invite", {
      _code: code,
      _user_id: userId,
    });
    if (acceptError) {
      await rollback("accept_worker_invite", acceptError);
      return { fieldErrors: { inviteCode: "invalidInvite" }, values };
    }
  }
  // Invited accounts leave the trial the database started for them.
  if (decision.kind === "beta" || decision.kind === "worker") {
    const { error: betaError } = await admin.rpc("grant_beta_plan", { _user_id: userId });
    if (betaError) {
      await rollback("grant_beta_plan", betaError);
      return { error: "generic", values };
    }
  }
  const timeZone = isValidTimeZone(parsed.data.timeZone) ? parsed.data.timeZone : DEFAULT_TIME_ZONE;
  const country = countryFromTimeZone(timeZone);
  const formats = regionFormats(country);
  const [settingsResult, profileResult] = await Promise.all([
    admin
      .from("user_settings")
      .update({
        timezone: timeZone,
        ...(country ? { country_code: country } : {}),
        currency: formats.currency,
        date_format: formats.dateFormat,
        time_format: formats.timeFormat,
        number_format: formats.numberFormat,
        first_day_of_week: formats.weekStartsOn,
      })
      .eq("user_id", userId),
    parsed.data.displayName
      ? admin.from("profiles").update({ display_name: parsed.data.displayName }).eq("id", userId)
      : Promise.resolve({ error: null }),
  ]);
  if (settingsResult.error) console.error("[auth] initial settings failed", settingsResult.error);
  if (profileResult.error) console.error("[auth] initial profile failed", profileResult.error);

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (signInError) redirect(loginPath(locale));

  await setLocaleCookie(locale);
  redirect(HOME_PATH);
}

/** Always reports success so the form cannot be used to find out who has an account. */
export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  const values = { email: String(formData.get("email") ?? "") };
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const supabase = await createClient();
  const origin = await siteOrigin();
  const resetPath = localizedPath("resetPassword", await getLocale());
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(resetPath)}`,
  });
  if (error) {
    const key = authErrorKey(error);
    if (key === "rateLimited") return { error: key, values };
    console.error("[auth] resetPasswordForEmail failed", error);
  }
  return { success: true, values };
}

export async function resetPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub || !isFreshRecoverySession(claims.claims.amr)) {
    return { error: "linkExpired" };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const key = authErrorKey(error);
    if (key === "samePassword" || key === "weakPassword") return { fieldErrors: { password: key } };
    return { error: key };
  }

  await syncLocaleFromSettings(claims.claims.sub);
  redirect(HOME_PATH);
}
