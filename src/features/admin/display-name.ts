/**
 * How the administration names a person: the profile name, else the sign-in
 * e-mail, else "Unnamed account" with the last four characters of the id.
 * The id itself is shown only as a small code in the user's detail. Names and
 * e-mails are read on the server for the administration only; analytics and
 * usage_events stay free of them.
 */

export type PersonInfo = { name: string | null; email: string | null };

/** The last characters of an id that tell two unnamed accounts apart. */
export function idSuffix(id: string): string {
  return id.replace(/-/g, "").slice(-4);
}

/**
 * `unnamed` builds the translated fallback (`admin.people.unnamed`) from the
 * id suffix, so this stays free of any text of its own.
 */
export function displayName(
  id: string,
  person: Partial<PersonInfo> | null | undefined,
  unnamed: (suffix: string) => string,
): string {
  const name = person?.name?.trim();
  if (name) return name;
  const email = person?.email?.trim();
  if (email) return email;
  return unnamed(idSuffix(id));
}
