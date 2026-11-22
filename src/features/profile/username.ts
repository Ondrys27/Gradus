export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_PATTERN = /^[a-z0-9._]{3,20}$/;

export type UsernameProblem = "tooShort" | "tooLong" | "invalidChars";

/** Lowercases as the user types and drops spaces; other characters stay so we can explain them. */
export function normalizeUsernameInput(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

export function usernameProblem(value: string): UsernameProblem | null {
  if (/[^a-z0-9._]/.test(value)) return "invalidChars";
  if (value.length < USERNAME_MIN) return "tooShort";
  if (value.length > USERNAME_MAX) return "tooLong";
  return null;
}

/** Days between two changes of a username; the old one stays reserved as long (28.1). */
export const USERNAME_CHANGE_DAYS = 30;

/**
 * When the username may change again: 30 days after the last change from a
 * previous name (profiles.username_changed_at, stamped by the database), or
 * null when it may change now. Setting the first one does not count.
 */
export function usernameUnlocksAt(changedAt: string | null | undefined, now: Date): Date | null {
  if (!changedAt) return null;
  const at = new Date(changedAt).getTime();
  if (Number.isNaN(at)) return null;
  const unlocks = at + USERNAME_CHANGE_DAYS * 86_400_000;
  return unlocks > now.getTime() ? new Date(unlocks) : null;
}
