/** The e-mail typed to confirm a deletion: the account's own, ignoring case and spaces around. */
export function sameEmail(typed: string, actual: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase();
  return normalize(typed) !== "" && normalize(typed) === normalize(actual);
}
