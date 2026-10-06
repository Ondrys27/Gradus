import { z } from "zod";

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
  timeZone: z.string().max(64).default(""),
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
