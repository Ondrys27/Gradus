"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { isFreshRecoverySession } from "@/lib/auth/recovery";
import { HOME_PATH, RESET_PASSWORD_PATH, safeNextPath } from "@/lib/auth/routes";
import { locales, type Locale } from "@/i18n/locales";
import {
  countryFromTimeZone,
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  regionFormats,
} from "@/lib/region";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isValidInviteCode } from "./invite-code";
import {
  authErrorKey,
  fieldErrorsFrom,
  forgotPasswordSchema,
  newPasswordSchema,
  signInSchema,
  signUpSchema,
  type FormState,
} from "./schemas";

const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

async function setLocaleCookie(locale: string) {
  if (!locales.includes(locale as Locale)) return;
  (await cookies()).set("locale", locale, {
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

/**
 * Base URL for links in e-mails. The configured site URL wins, so a forged
 * Origin or Host header can never point a reset link at another site.
 */
async function requestOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
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
 * Registration is closed: public sign-ups are disabled in Supabase, so the
 * account can only be created here, after the invite code has been checked.
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

  const expected = process.env.INVITE_CODE;
  if (!expected) return { error: "registrationClosed", values };
  if (!isValidInviteCode(parsed.data.inviteCode, expected)) {
    return { fieldErrors: { inviteCode: "invalidInvite" }, values };
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
  if (signInError) redirect("/login");

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
  const origin = await requestOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(RESET_PASSWORD_PATH)}`,
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
