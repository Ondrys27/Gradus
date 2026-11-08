/**
 * The active space on the wire (step 22.4), without imports so the Supabase
 * clients can use it: the cookie the person's choice is kept in and the
 * header every database request names the space with.
 */

export const ACTIVE_SPACE_COOKIE = "active_space";
export const SPACE_HEADER = "x-gradus-space";
/** A year: the choice stays on this device until the person switches again. */
export const ACTIVE_SPACE_MAX_AGE = 60 * 60 * 24 * 365;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSpaceId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The value of the active space cookie in a `document.cookie` string, when it is a space id. */
export function readSpaceCookie(cookieHeader: string | null | undefined): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== ACTIVE_SPACE_COOKIE) continue;
    const value = decodeURIComponent(rest.join("="));
    return isSpaceId(value) ? value : null;
  }
  return null;
}

/** The header that tells the database which space the request is about. */
export function spaceHeaders(space: string | null | undefined): Record<string, string> {
  return isSpaceId(space) ? { [SPACE_HEADER]: space } : {};
}
