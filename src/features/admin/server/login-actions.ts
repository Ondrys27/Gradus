"use server";

import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { z } from "zod";
import { APP_NAME } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import {
  ADMIN_ATTEMPTS_LOOKBACK_MS,
  isFreshPasswordSession,
  isFreshTotpSession,
  lockedUntil,
  minutesLeft,
  type AdminClaims,
} from "../access";
import { logAdminAction } from "./audit";
import { adminAccess, isOwnerAccount } from "./guard";
import { sendAdminLoginEmail } from "./login-email";
import { fingerprint, requestInfo } from "./request-info";

/**
 * The sign-in to the administration: password, then the code from the
 * authenticator app (or setting it up the first time). These actions run
 * before anyone is let in, so each checks everything itself and answers a
 * stranger exactly as it answers a wrong password.
 */

type Admin = ReturnType<typeof createAdminClient>;
type Keys = { ip: string; email: string | null };

export type AdminLoginError = "invalid" | "invalidCode" | "locked" | "restart" | "generic";
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

async function keysFor(email: string | null | undefined): Promise<Keys> {
  const { ip } = await requestInfo();
  return { ip: fingerprint("ip", ip), email: email ? fingerprint("email", email) : null };
}

/** The end of a running pause for this address or this account; errors count as locked. */
async function currentLock(admin: Admin, keys: Keys): Promise<Date | "error" | null> {
  const since = new Date(Date.now() - ADMIN_ATTEMPTS_LOOKBACK_MS).toISOString();
  const filter = keys.email
    ? `ip_hash.eq.${keys.ip},email_hash.eq.${keys.email}`
    : `ip_hash.eq.${keys.ip}`;
  const { data, error } = await admin
    .from("admin_login_attempts")
    .select("ip_hash, email_hash, success, created_at")
    .gte("created_at", since)
    .or(filter)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    console.error("[admin] reading sign-in attempts failed", error.message);
    return "error";
  }
  const toAttempt = (row: (typeof data)[number]) => ({ at: row.created_at, success: row.success });
  const locks = [
    lockedUntil(data.filter((row) => row.ip_hash === keys.ip).map(toAttempt)),
    keys.email
      ? lockedUntil(data.filter((row) => row.email_hash === keys.email).map(toAttempt))
      : null,
  ].filter((lock): lock is Date => lock !== null);
  return locks.length ? new Date(Math.max(...locks.map((lock) => lock.getTime()))) : null;
}

async function recordAttempt(
  admin: Admin,
  keys: Keys,
  stage: "password" | "totp",
  success: boolean,
): Promise<void> {
  const { error } = await admin
    .from("admin_login_attempts")
    .insert({ ip_hash: keys.ip, email_hash: keys.email, stage, success });
  if (error) console.error("[admin] recording a sign-in attempt failed", error.message);
  // The limit looks one hour back; attempts older than a day are not kept.
  await admin
    .from("admin_login_attempts")
    .delete()
    .lt("created_at", new Date(Date.now() - 24 * 3_600_000).toISOString());
}

/** A wrong password or code: counted, and the pause reported if this one started it. */
async function failure(
  admin: Admin,
  keys: Keys,
  stage: "password" | "totp",
  error: AdminLoginError,
): Promise<{ error: AdminLoginError; minutes?: number }> {
  await recordAttempt(admin, keys, stage, false);
  const lock = await currentLock(admin, keys);
  if (lock === "error") return { error: "generic" };
  return lock ? { error: "locked", minutes: minutesLeft(lock) } : { error };
}

async function totpFactors(admin: Admin, userId: string) {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  return data.factors.filter((factor) => factor.factor_type === "totp");
}

/**
 * The owner's session from a moment ago: the password step for the first
 * code, the code itself for adding a backup device.
 */
async function ownerSignInSession(fresh: "password" | "totp" = "password") {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as AdminClaims | undefined;
  const isFresh = fresh === "password" ? isFreshPasswordSession : isFreshTotpSession;
  if (!claims?.sub || !isFresh(claims)) return null;
  const admin = createAdminClient();
  if (!(await isOwnerAccount(claims.sub))) return null;
  return { supabase, admin, claims, userId: claims.sub };
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
  // gets a session out of this page.
  const probe = createStatelessClient<Database>(supabaseUrl(), supabasePublicKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await probe.auth.signInWithPassword(parsed.data);
  const session = !error ? data.session : null;
  const owner = session ? await isOwnerAccount(session.user.id) : false;
  if (!session || !owner) {
    if (session) await probe.auth.signOut({ scope: "local" });
    return { ok: false, email, ...(await failure(admin, keys, "password", "invalid")) };
  }

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
    const factors = await totpFactors(admin, session.user.id);
    return { ok: true, next: factors.some((f) => f.status === "verified") ? "verify" : "enroll" };
  } catch (listError) {
    console.error("[admin] listing factors failed", listError);
    return { ok: false, error: "generic", email };
  }
}

/**
 * A new authenticator for the owner: the first one right after the password,
 * a backup one right after the code. Unfinished set-ups are removed first.
 */
export async function startAdminEnrollment(kind: "primary" | "backup"): Promise<EnrollResult> {
  const context = await ownerSignInSession(kind === "primary" ? "password" : "totp");
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
 * the backup device works too; "enroll" and "backup" finish a new one.
 */
export async function verifyAdminCode(input: {
  mode: "login" | "enroll" | "backup";
  code: string;
  factorId?: string;
}): Promise<VerifyResult> {
  const context = await ownerSignInSession(input.mode === "backup" ? "totp" : "password");
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
  if (!verified) return { ok: false, ...(await failure(admin, keys, "totp", "invalidCode")) };

  await recordAttempt(admin, keys, "totp", true);
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
