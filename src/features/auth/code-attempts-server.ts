import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fingerprint, requestInfo } from "@/features/admin/server/request-info";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import {
  CODE_ATTEMPT_LIMITS,
  codeLockedUntil,
  type CodeAttemptKeys,
  type CodeAttemptKind,
  type CodeAttemptRow,
  type CodeAttemptStage,
} from "./code-attempts";
import { isE2eTestAccount } from "./e2e-account";

/**
 * Reading and recording wrong invite and promo codes (signup_code_attempts,
 * server only, admin client). Keys are keyed hashes of the address and of the
 * e-mail in the form (or of the signed-in account), never the values. The
 * tests' own accounts outside production share one address on the machine
 * that runs them and are never counted or held back.
 */

type Admin = SupabaseClient<Database>;

export type CodeGuard = {
  keys: CodeAttemptKeys;
  /** The tests' own account outside production: nothing is counted. */
  exempt: boolean;
};

/** `who`: the e-mail of the form, or `{ account }` for a signed-in owner. */
export async function codeGuard(who?: string | { account: string } | null): Promise<CodeGuard> {
  const { ip } = await requestInfo();
  const email = typeof who === "string" ? who.trim() : "";
  const account =
    typeof who === "object" && who
      ? fingerprint("account", who.account)
      : email
        ? fingerprint("email", email)
        : null;
  return { keys: { ip: fingerprint("ip", ip), account }, exempt: Boolean(email) && isE2eTestAccount(email) };
}

/** Whether a pause runs for these keys; a failed read counts as a pause (never guess open). */
export async function codesLocked(guard: CodeGuard, admin: Admin = createAdminClient()): Promise<boolean> {
  if (guard.exempt) return false;
  const since = new Date(Date.now() - CODE_ATTEMPT_LIMITS.lookbackMs).toISOString();
  const filter = guard.keys.account
    ? `ip_hash.eq.${guard.keys.ip},account_hash.eq.${guard.keys.account}`
    : `ip_hash.eq.${guard.keys.ip}`;
  const { data, error } = await admin
    .from("signup_code_attempts")
    .select("ip_hash, account_hash, stage, created_at")
    .gte("created_at", since)
    .or(filter)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    console.error("[auth] reading code attempts failed", error.message);
    return true;
  }
  return codeLockedUntil(data as CodeAttemptRow[], guard.keys) !== null;
}

/** One wrong code; older rows than a day go at the same time. */
export async function recordWrongCode(
  guard: CodeGuard,
  kind: CodeAttemptKind,
  stage: CodeAttemptStage,
  admin: Admin = createAdminClient(),
): Promise<void> {
  if (guard.exempt) return;
  const { error } = await admin.from("signup_code_attempts").insert({
    ip_hash: guard.keys.ip,
    account_hash: guard.keys.account,
    kind,
    stage,
  });
  if (error) console.error("[auth] recording a code attempt failed", error.message);
  await admin
    .from("signup_code_attempts")
    .delete()
    .lt("created_at", new Date(Date.now() - 24 * 3_600_000).toISOString());
}
