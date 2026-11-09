import { lockedUntil } from "@/features/admin/access";

/**
 * The limit on guessing invite and promo codes, like the administration's
 * sign-in: five wrong codes in a sent form within 15 minutes from one address
 * or for one e-mail start a 15-minute pause. The promo field also asks while
 * typing (a few prefixes of a real code are "not found" on the way), so its
 * checks count more loosely: twenty within 15 minutes from one address. A
 * right code does not clear the count, so a known code can not be used to
 * keep guessing. During a pause every code is refused, a right one too.
 * The rows come from signup_code_attempts (server only, keyed hashes).
 */

export const CODE_ATTEMPT_LIMITS = {
  submit: 5,
  check: 20,
  lockoutMs: 15 * 60_000,
  /** How far back the rows are read; enough to see any pause still running. */
  lookbackMs: 60 * 60_000,
} as const;

export type CodeAttemptStage = "check" | "submit";
export type CodeAttemptKind = "invite" | "promo";

export type CodeAttemptRow = {
  ip_hash: string;
  account_hash: string | null;
  stage: CodeAttemptStage;
  created_at: string;
};

export type CodeAttemptKeys = { ip: string; account: string | null };

/** When the pause for these keys ends, or null. */
export function codeLockedUntil(
  rows: readonly CodeAttemptRow[],
  keys: CodeAttemptKeys,
  now: Date = new Date(),
): Date | null {
  const failures = (match: (row: CodeAttemptRow) => boolean) =>
    rows.filter(match).map((row) => ({ at: row.created_at, success: false }));
  const strict = { maxFailures: CODE_ATTEMPT_LIMITS.submit, lockoutMs: CODE_ATTEMPT_LIMITS.lockoutMs };
  const loose = { maxFailures: CODE_ATTEMPT_LIMITS.check, lockoutMs: CODE_ATTEMPT_LIMITS.lockoutMs };
  const locks = [
    lockedUntil(failures((row) => row.ip_hash === keys.ip && row.stage === "submit"), now, strict),
    keys.account
      ? lockedUntil(
          failures((row) => row.account_hash === keys.account && row.stage === "submit"),
          now,
          strict,
        )
      : null,
    lockedUntil(failures((row) => row.ip_hash === keys.ip), now, loose),
  ].filter((lock): lock is Date => lock !== null);
  return locks.length ? new Date(Math.max(...locks.map((lock) => lock.getTime()))) : null;
}
