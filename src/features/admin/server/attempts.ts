import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ADMIN_ATTEMPTS_LOOKBACK_MS, lockedUntil, minutesLeft } from "../access";
import { hashInviteToken, isWellFormedInviteToken } from "../invite-token";
import { fingerprint, requestInfo } from "./request-info";

/**
 * The attempt limit shared by the sign-in and the invitation links: five
 * failures within 15 minutes from one address (or for one e-mail) start a
 * 15-minute pause. Server only; never exported as an action.
 */

export type Admin = ReturnType<typeof createAdminClient>;
export type Keys = { ip: string; email: string | null };
export type AttemptStage = "password" | "totp" | "invite";

export async function keysFor(email: string | null | undefined): Promise<Keys> {
  const { ip } = await requestInfo();
  return { ip: fingerprint("ip", ip), email: email ? fingerprint("email", email) : null };
}

/** The end of a running pause for this address or this account; errors count as locked. */
export async function currentLock(admin: Admin, keys: Keys): Promise<Date | "error" | null> {
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

export async function recordAttempt(
  admin: Admin,
  keys: Keys,
  stage: AttemptStage,
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

/** A wrong password, code or link: counted, and the pause reported if this one started it. */
export async function failure<E extends string>(
  admin: Admin,
  keys: Keys,
  stage: AttemptStage,
  error: E,
): Promise<{ error: E | "locked" | "generic"; minutes?: number }> {
  await recordAttempt(admin, keys, stage, false);
  const lock = await currentLock(admin, keys);
  if (lock === "error") return { error: "generic" };
  return lock ? { error: "locked", minutes: minutesLeft(lock) } : { error };
}

/**
 * The id of an invitation that can still be used, or null. Reads with the
 * admin client. `unclaimed`: only when no account has been created on it yet
 * (the check before creating one; admin_invite_claim decides for real).
 */
export async function findOpenInvite(
  admin: Admin,
  token: unknown,
  options: { unclaimed?: boolean } = {},
): Promise<string | null> {
  if (!isWellFormedInviteToken(token)) return null;
  let query = admin
    .from("admin_invites")
    .select("id")
    .eq("token_hash", hashInviteToken(token))
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  if (options.unclaimed) query = query.is("claimed_by", null);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("[admin] reading an invitation failed", error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Opening an invitation link: the same pause as the sign-in for an address
 * that tries links, and a wrong link counted. Says only usable or not.
 */
export async function checkInviteLink(token: string): Promise<boolean> {
  const admin = createAdminClient();
  const keys = await keysFor(null);
  const lock = await currentLock(admin, keys);
  if (lock !== null) return false;
  if (await findOpenInvite(admin, token)) return true;
  await recordAttempt(admin, keys, "invite", false);
  return false;
}
