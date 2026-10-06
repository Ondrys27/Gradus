import "server-only";

/**
 * The contact address in the website footer: CONTACT_EMAIL, otherwise the
 * owner's OWNER_EMAIL. Read when the page is generated; empty hides the link.
 */
export function contactEmail(): string | null {
  const email = (process.env.CONTACT_EMAIL || process.env.OWNER_EMAIL || "").trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? email : null;
}
