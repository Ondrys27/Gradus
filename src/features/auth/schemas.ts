import { z } from "zod";
import type { PromoActionProblem } from "@/features/promo/actions";

/** Supabase rejects bcrypt inputs over 72 bytes; 8 is our floor everywhere. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const DISPLAY_NAME_MAX = 60;

/** Translation keys under `auth.errors`. */
export type AuthErrorKey =
  | "invalidEmail"
  | "passwordTooShort"
  | "passwordTooLong"
  | "passwordsDontMatch"
  | "displayNameTooLong"
  | "inviteRequired"
  | "invalidInvite"
  | "inviteEmailMismatch"
  | "registrationClosed"
  | "invalidCredentials"
  | "emailTaken"
  | "weakPassword"
  | "samePassword"
  | "wrongCurrentPassword"
  | "rateLimited"
  | "linkExpired"
  | "emailNotConfirmed"
  | "termsRequired"
  | "tooManyCodeAttempts"
  | "generic";

const email = z.string().trim().toLowerCase().email("invalidEmail");
const password = z
  .string()
  .min(PASSWORD_MIN, "passwordTooShort")
  .max(PASSWORD_MAX, "passwordTooLong");

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "invalidCredentials"),
});

export const signUpSchema = z.object({
  displayName: z.string().trim().max(DISPLAY_NAME_MAX, "displayNameTooLong"),
  email,
  password,
  // Required unless public sign-up is on; the server decides (decideSignup).
  inviteCode: z.string().trim().max(64).default(""),
  // A partner's promo code (optional); checked again on the server before the account is made.
  promoCode: z.string().trim().max(64).default(""),
  timeZone: z.string().max(64).default(""),
  // The terms and the privacy policy: required, the server records when and which version.
  terms: z
    .string()
    .default("")
    .refine((value) => value === "on", "termsRequired"),
  // News by e-mail: optional and separate.
  marketing: z.string().max(8).default(""),
  // The plan picked on the website (?tarif=pro&obdobi=rok); parseSignupPlan decides what it is.
  plan: z.string().max(16).default(""),
  billing: z.string().max(16).default(""),
});

export const forgotPasswordSchema = z.object({ email });

export const newPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "passwordsDontMatch", path: ["confirm"] });

export const changePasswordSchema = z
  .object({ current: z.string().min(1, "wrongCurrentPassword"), password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "passwordsDontMatch", path: ["confirm"] });

export type FormState = {
  /** Form-level error. */
  error?: AuthErrorKey;
  /** Per-field errors, keyed by input name. */
  fieldErrors?: Partial<Record<string, AuthErrorKey>>;
  /** Why the promo code cannot be used (a key under `promo.problems`). */
  promo?: PromoActionProblem;
  /** Echoed back so the form keeps what was typed (never passwords). */
  values?: Partial<Record<string, string>>;
  success?: boolean;
};

export function fieldErrorsFrom(error: z.ZodError): FormState["fieldErrors"] {
  const out: Record<string, AuthErrorKey> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    out[field] ??= issue.message as AuthErrorKey;
  }
  return out;
}

/** Maps Supabase Auth error codes to our translation keys. */
export function authErrorKey(error: { code?: string; status?: number } | null): AuthErrorKey {
  switch (error?.code) {
    case "invalid_credentials":
      return "invalidCredentials";
    case "email_exists":
    case "user_already_exists":
      return "emailTaken";
    case "weak_password":
      return "weakPassword";
    case "email_not_confirmed":
      return "emailNotConfirmed";
    case "same_password":
      return "samePassword";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "rateLimited";
    case "otp_expired":
    case "flow_state_expired":
    case "flow_state_not_found":
    case "bad_code_verifier":
      return "linkExpired";
  }
  if (error?.status === 429) return "rateLimited";
  return "generic";
}
