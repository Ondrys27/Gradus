import { z } from "zod";
import { USERNAME_PATTERN } from "@/features/profile/username";

/**
 * Whom an invite goes to: somebody who already has the app, by their
 * username (@jmeno, 28.1) or short id (Settings → Account, six characters
 * without look-alikes, 22.5), or an e-mail. An e-mail of an existing account
 * makes an invite waiting in the app, any other e-mail a link for a new
 * person.
 *
 * The same reading as invite_account_lookup() in the database: "@name" is a
 * username; six characters of the short id alphabet are a short id (the
 * server falls back to a username of the same letters); anything else that
 * fits a username is one. Only exact matches, never a part.
 */

/** The alphabet of profiles.public_id (new_public_id in the database). */
export const PUBLIC_ID_PATTERN = /^[2-9A-HJKMNP-TV-Z]{6}$/;

export type InviteTarget =
  | { kind: "id"; publicId: string }
  | { kind: "username"; username: string }
  | { kind: "email"; email: string };

/** Somebody who has the app: a short id or a username. */
export type AccountTarget = Exclude<InviteTarget, { kind: "email" }>;

export type InviteTargetError = "targetRequired" | "targetInvalid";

const emailSchema = z.string().email().max(254);

/** A typed short id as stored: upper case, without spaces or dashes ("7k3-m9q" → "7K3M9Q"). */
export function normalizePublicId(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

type Parsed = { ok: true; target: InviteTarget } | { ok: false; error: InviteTargetError };

/** A username or short id only (the "already uses the app" field). */
export function parseAccountTarget(
  value: string,
): { ok: true; target: AccountTarget } | { ok: false; error: InviteTargetError } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "targetRequired" };
  if (trimmed.startsWith("@")) {
    const username = trimmed.slice(1).toLowerCase();
    return USERNAME_PATTERN.test(username)
      ? { ok: true, target: { kind: "username", username } }
      : { ok: false, error: "targetInvalid" };
  }
  const publicId = normalizePublicId(trimmed);
  if (PUBLIC_ID_PATTERN.test(publicId)) return { ok: true, target: { kind: "id", publicId } };
  const username = trimmed.toLowerCase();
  return USERNAME_PATTERN.test(username)
    ? { ok: true, target: { kind: "username", username } }
    : { ok: false, error: "targetInvalid" };
}

export function parseInviteTarget(value: string): Parsed {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "targetRequired" };
  if (trimmed.includes("@") && !trimmed.startsWith("@")) {
    const email = trimmed.toLowerCase();
    return emailSchema.safeParse(email).success
      ? { ok: true, target: { kind: "email", email } }
      : { ok: false, error: "targetInvalid" };
  }
  return parseAccountTarget(trimmed);
}

/** What goes to the server for an account: the short id, or "@username". */
export function accountTargetValue(target: AccountTarget): string {
  return target.kind === "id" ? target.publicId : `@${target.username}`;
}
