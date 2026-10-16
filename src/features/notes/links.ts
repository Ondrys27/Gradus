/**
 * A link typed into a note: "gradus.app" becomes "https://gradus.app", an
 * e-mail becomes mailto:, and only http(s) and mailto are ever kept, so a
 * note can never carry a javascript: or data: link. Empty or unusable → null.
 */
export function normalizeLink(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(value)) return `mailto:${value}`;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol === "mailto:") return url.href;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** The Link extension's check for every link that enters a note (typed, pasted, loaded). */
export function isAllowedLink(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url.trim());
}
