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
