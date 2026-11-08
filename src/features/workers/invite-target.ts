import { z } from "zod";

/**
 * Whom an invite goes to (step 22.5): the short id of someone who already
 * has the app (Settings → Account, six characters without look-alikes) or an
 * e-mail. An e-mail of an existing account makes an invite waiting in the
 * app, any other e-mail a link for a new person, as before. One field takes
 * both; the short id is told apart by its shape.
 */

/** The alphabet of profiles.public_id (new_public_id in the database). */
export const PUBLIC_ID_PATTERN = /^[2-9A-HJKMNP-TV-Z]{6}$/;

export type InviteTarget =
  | { kind: "id"; publicId: string }
  | { kind: "email"; email: string };

export type InviteTargetError = "targetRequired" | "targetInvalid";

const emailSchema = z.string().email().max(254);

/** A typed short id as stored: upper case, without spaces or dashes ("7k3-m9q" → "7K3M9Q"). */
export function normalizePublicId(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function parseInviteTarget(
  value: string,
): { ok: true; target: InviteTarget } | { ok: false; error: InviteTargetError } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "targetRequired" };
  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    return emailSchema.safeParse(email).success
      ? { ok: true, target: { kind: "email", email } }
      : { ok: false, error: "targetInvalid" };
  }
  const publicId = normalizePublicId(trimmed);
  return PUBLIC_ID_PATTERN.test(publicId)
    ? { ok: true, target: { kind: "id", publicId } }
    : { ok: false, error: "targetInvalid" };
}
