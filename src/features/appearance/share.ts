/**
 * Sharing a custom theme with a colleague (30.6): every theme has a code of
 * 10 characters (the alphabet of the short ID, no 0/O/1/I/L), made by the
 * database. A colleague from a company the author belongs to imports a copy
 * by the code or by the link; nobody else can read it.
 */

export const SHARE_CODE_LENGTH = 10;
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE = new RegExp(`^[${ALPHABET}]{${SHARE_CODE_LENGTH}}$`);

/** The query parameter of the import link on Settings → Appearance. */
export const SHARE_PARAM = "vzhled";
export const APPEARANCE_PATH = "/app/nastaveni/vzhled";
export const THEME_EDITOR_PATH = "/app/nastaveni/vzhled/vlastni";

/** A pasted code or link as the code, else null (spaces, dashes and lower case are forgiven). */
export function parseShareCode(input: string): string | null {
  const text = input.trim();
  let candidate = text;
  const fromLink = /[?&]vzhled=([^&#\s]+)/i.exec(text);
  if (fromLink) candidate = decodeURIComponent(fromLink[1]);
  const code = candidate.toUpperCase().replace(/[\s-]/g, "");
  return CODE.test(code) ? code : null;
}

export function shareLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}${APPEARANCE_PATH}?${SHARE_PARAM}=${code}`;
}

/** "ABCDE-FGHJK", easier to read aloud. */
export function formatShareCode(code: string): string {
  return code.length === SHARE_CODE_LENGTH ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}
