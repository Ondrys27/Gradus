"use server";

import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { authErrorKey, PASSWORD_MAX, PASSWORD_MIN } from "@/features/auth/schemas";
import { APP_NAME } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { isFreshPasswordSession, isFreshTotpSession, minutesLeft, type AdminClaims } from "../access";
import { hashInviteToken } from "../invite-token";
import { currentLock, failure, findOpenInvite, keysFor, recordAttempt, type Admin } from "./attempts";
import { logAdminAction } from "./audit";
import { adminAccess, isAdminAccount } from "./guard";
import { sendAdminLoginEmail } from "./login-email";
import { fingerprint, requestInfo } from "./request-info";

/**
 * The sign-in to the administration: password, then the code from the
 * authenticator app (or setting it up the first time). These actions run
 * before anyone is let in, so each checks everything itself and answers a
 * stranger exactly as it answers a wrong password.
 *
 * The same steps serve an invitation link (`invite`, the token from the
 * address): the password step signs in or creates the account, the code step
 * then accepts the invitation, which grants the admin role.
 */

export type AdminLoginError =
  | "invalid"
  | "invalidCode"
  | "locked"
  | "restart"
  | "generic"
  | "inviteInvalid"
  | "emailTaken"
  | "passwordTooShort"
  | "passwordTooLong";
export type AdminSignInState =
  | { ok: false; error?: AdminLoginError; minutes?: number; email?: string }
  | { ok: true; next: "enroll" | "verify" };
export type EnrollResult =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: AdminLoginError };
export type VerifyResult =
  { ok: true; next: "backup" | "admin" } | { ok: false; error: AdminLoginError; minutes?: number };

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});
const codeSchema = z.string().regex(/^\d{6}$/);
const factorIdSchema = z.string().uuid();

async function totpFactors(admin: Admin, userId: string) {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  return data.factors.filter((factor) => factor.factor_type === "totp");
}

/**
 * The session from a moment ago (the password step for the first code, the
 * code itself for adding a backup device) of the owner, an admin, or anyone
 * holding an invitation that can still be used.
 */
async function signInSession(fresh: "password" | "totp" = "password", invite?: string) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as AdminClaims | undefined;
  const isFresh = fresh === "password" ? isFreshPasswordSession : isFreshTotpSession;
  if (!claims?.sub || !isFresh(claims)) return null;
  const admin = createAdminClient();
  const allowed =
    (await isAdminAccount(claims.sub)) || (invite !== undefined && !!(await findOpenInvite(admin, invite)));
  if (!allowed) return null;
  return { supabase, admin, claims, userId: claims.sub };
}

function statelessClient() {
  return createStatelessClient<Database>(supabaseUrl(), supabasePublicKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Keeps a session made outside the browser's cookies, then says which code step follows. */
async function continueWith(
  session: { access_token: string; refresh_token: string; user: { id: string } },
  email: string,
): Promise<AdminSignInState> {
  const supabase = await createClient();
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (sessionError) {
    console.error("[admin] storing the session failed", sessionError.message);
    return { ok: false, error: "generic", email };
  }
  try {
    const factors = await totpFactors(createAdminClient(), session.user.id);
    return { ok: true, next: factors.some((f) => f.status === "verified") ? "verify" : "enroll" };
  } catch (listError) {
    console.error("[admin] listing factors failed", listError);
    return { ok: false, error: "generic", email };
  }
}

export async function adminSignIn(
  _prev: AdminSignInState,
  formData: FormData,
): Promise<AdminSignInState> {
  const email = String(formData.get("email") ?? "").slice(0, 254);
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "invalid", email };

  const admin = createAdminClient();
  const keys = await keysFor(parsed.data.email);
  const lock = await currentLock(admin, keys);
  if (lock === "error") return { ok: false, error: "generic", email };
  if (lock) return { ok: false, error: "locked", minutes: minutesLeft(lock), email };

  // The password is tried outside the browser's cookies: nobody but the owner
  // or an admin gets a session out of this page.
  const probe = statelessClient();
  const { data, error } = await probe.auth.signInWithPassword(parsed.data);
  const session = !error ? data.session : null;
  const allowed = session ? await isAdminAccount(session.user.id) : false;
  if (!session) {
    return { ok: false, email, ...(await failure(admin, keys, "password", "invalid" as const)) };
  }
  if (!allowed) {
    // The right password of an account that is neither owner nor admin:
    // counted like a wrong one, and the administration answers with the
    // site's ordinary 404. A wrong password looks the same whether the
    // e-mail exists or not.
    await probe.auth.signOut({ scope: "local" });
    await failure(admin, keys, "password", "invalid");
    notFound();
  }
  return continueWith(session, email);
}

const inviteFormSchema = z.object({
  invite: z.string().max(100),
  mode: z.enum(["signin", "signup"]),
});

/**
 * The password step of an invitation link: an existing account signs in, a
 * new one is created (e-mail and password, no onboarding, no workspace,
 * internal). A link that cannot be used gets one neutral answer.
 */
export async function adminInviteSignIn(
  _prev: AdminSignInState,
  formData: FormData,
): Promise<AdminSignInState> {
  const email = String(formData.get("email") ?? "").slice(0, 254);
  const form = inviteFormSchema.safeParse({ invite: formData.get("invite"), mode: formData.get("mode") });
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  const admin = createAdminClient();
  const keys = await keysFor(parsed.success ? parsed.data.email : null);
  const lock = await currentLock(admin, keys);
  if (lock === "error") return { ok: false, error: "generic", email };
  if (lock) return { ok: false, error: "locked", minutes: minutesLeft(lock), email };

  if (!form.success || !(await findOpenInvite(admin, form.data.invite))) {
    const ipOnly = { ip: keys.ip, email: null };
    return { ok: false, email, ...(await failure(admin, ipOnly, "invite", "inviteInvalid" as const)) };
  }
  if (!parsed.success) return { ok: false, error: "invalid", email };
  const { mode, invite } = form.data;
  // From here on `keys` hold the address and the e-mail: every failure below
  // counts towards the same pause as a wrong password or link.

  let createdUserId: string | null = null;
  if (mode === "signup") {
    // One new account per invitation: a link someone already signed up with
    // answers like a used one (admin_invite_claim below decides for real).
    if (!(await findOpenInvite(admin, invite, { unclaimed: true }))) {
      return { ok: false, email, ...(await failure(admin, keys, "invite", "inviteInvalid" as const)) };
    }
    const password = parsed.data.password;
    if (password.length < PASSWORD_MIN) return { ok: false, error: "passwordTooShort", email };
    if (password.length > PASSWORD_MAX) return { ok: false, error: "passwordTooLong", email };
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password,
      email_confirm: true,
      // admin_invite: the database gives this account a profile only (no workspace, no trial).
      user_metadata: { locale: await getLocale(), admin_invite: true },
    });
    if (createError || !created.user) {
      // An existing e-mail is said once, then counted like any other failure,
      // so the page cannot be used to test addresses one after another.
      if (createError && authErrorKey(createError) === "emailTaken") {
        return { ok: false, email, ...(await failure(admin, keys, "invite", "emailTaken" as const)) };
      }
      console.error("[admin] creating the invited account failed", createError?.message);
      return { ok: false, error: "generic", email };
    }
    createdUserId = created.user.id;
  }

  const probe = statelessClient();
  const { data, error } = await probe.auth.signInWithPassword(parsed.data);
  if (error || !data.session) {
    return { ok: false, email, ...(await failure(admin, keys, "password", "invalid" as const)) };
  }

  if (createdUserId) {
    // The new account takes the invitation with its own session. Someone else
    // may have signed up on the same link a moment ago: then this account has
    // no use and is removed again.
    const { error: claimError } = await probe.rpc("admin_invite_claim", {
      _token_hash: hashInviteToken(invite),
    });
    if (claimError) {
      if (claimError.code !== "42501") {
        console.error("[admin] claiming the invitation failed", claimError.message);
      }
      // Deleting the account also ends the session it just got.
      const { error: deleteError } = await admin.auth.admin.deleteUser(createdUserId);
      if (deleteError) console.error("[admin] removing the unclaimed account failed", deleteError.message);
      return { ok: false, email, ...(await failure(admin, keys, "invite", "inviteInvalid" as const)) };
    }
  }
  return continueWith(data.session, email);
}

/**
 * A new authenticator: the first one right after the password, a backup one
 * right after the code. Unfinished set-ups are removed first.
 */
export async function startAdminEnrollment(
  kind: "primary" | "backup",
  invite?: string,
): Promise<EnrollResult> {
  const context = await signInSession(kind === "primary" ? "password" : "totp", invite);
  if (!context) return { ok: false, error: "restart" };
  const { supabase, admin, claims, userId } = context;
  try {
    const factors = await totpFactors(admin, userId);
    const hasVerified = factors.some((factor) => factor.status === "verified");
    if (kind === "primary" ? hasVerified : !hasVerified || !isFreshTotpSession(claims)) {
      return { ok: false, error: "restart" };
    }
    for (const factor of factors.filter((f) => f.status === "unverified")) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
      if (error) throw error;
    }
  } catch (error) {
    console.error("[admin] preparing the authenticator failed", error);
    return { ok: false, error: "generic" };
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `${kind}-${Date.now()}`,
    issuer: APP_NAME,
  });
  if (error || !data) {
    console.error("[admin] enrolling the authenticator failed", error?.message);
    return { ok: false, error: "generic" };
  }
  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * Checks the six-digit code. "login" tries every verified authenticator, so
 * the backup device works too; "enroll" and "backup" finish a new one. With
 * an invitation, the code is followed by accepting it (the admin role).
 */
export async function verifyAdminCode(input: {
  mode: "login" | "enroll" | "backup";
  code: string;
  factorId?: string;
  invite?: string;
}): Promise<VerifyResult> {
  const invite = input.mode === "backup" ? undefined : input.invite;
  const context = await signInSession(input.mode === "backup" ? "totp" : "password", invite);
  if (!context) return { ok: false, error: "restart" };
  const { supabase, admin, claims, userId } = context;

  const code = codeSchema.safeParse(String(input.code ?? "").replace(/\s/g, ""));
  if (!code.success) return { ok: false, error: "invalidCode" };

  const keys = await keysFor(claims.email);
  const lock = await currentLock(admin, keys);
  if (lock === "error") return { ok: false, error: "generic" };
  if (lock) return { ok: false, error: "locked", minutes: minutesLeft(lock) };

  let candidates: string[];
  try {
    const factors = await totpFactors(admin, userId);
    if (input.mode === "login") {
      candidates = factors.filter((f) => f.status === "verified").map((f) => f.id);
    } else {
      const factorId = factorIdSchema.safeParse(input.factorId);
      const pending = factors.find((f) => f.status === "unverified" && f.id === factorId.data);
      candidates = factorId.success && pending ? [pending.id] : [];
    }
  } catch (error) {
    console.error("[admin] listing factors failed", error);
    return { ok: false, error: "generic" };
  }
  if (!candidates.length) return { ok: false, error: "restart" };

  let verified = false;
  for (const factorId of candidates) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.data });
    if (!error) {
      verified = true;
      break;
    }
  }
  if (!verified) return { ok: false, ...(await failure(admin, keys, "totp", "invalidCode" as const)) };

  await recordAttempt(admin, keys, "totp", true);

  if (invite !== undefined) {
    // The session is aal2 now. The database consumes the link and grants the
    // role in one transaction; a second use, even at the same moment, fails.
    const { ip } = await requestInfo();
    const { error } = await supabase.rpc("admin_invite_accept", {
      _token_hash: hashInviteToken(invite),
      _ip_hash: fingerprint("ip", ip),
    });
    if (error) {
      if (error.code !== "42501") console.error("[admin] accepting the invitation failed", error.message);
      return { ok: false, error: "inviteInvalid" };
    }
  }

  if (input.mode !== "backup") {
    const { userAgent } = await requestInfo();
    await logAdminAction({ userId }, "login", "sign_in");
    if (claims.email) {
      await sendAdminLoginEmail({ userId, email: claims.email, userAgent, ipHash: keys.ip });
    }
  }
  return { ok: true, next: input.mode === "enroll" ? "backup" : "admin" };
}

/** Leaves the administration; the app session stays signed in. */
export async function endAdminSession(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_session_end");
  if (error) console.error("[admin] ending the admin session failed", error.message);
}

/** The open page reports input now and then, so reading a long table is not idleness. */
export async function adminHeartbeat(): Promise<{ ok: boolean; expiresAt?: string }> {
  const context = await adminAccess(true);
  return context ? { ok: true, expiresAt: context.expiresAt } : { ok: false };
}
