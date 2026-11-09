import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * The secrets of a booking (24.4). Server only.
 *
 *   * The hold's secret: 32 random bytes, only in the guest's browser for the
 *     five minutes of the hold; it proves the answers come from whoever
 *     clicked the time.
 *   * The link of the e-mails (/s/r/<token>) that moves or cancels the
 *     booking: an HMAC of the booking's id under a server key, so every later
 *     e-mail (approved, moved by the host) carries the same link without the
 *     token being stored anywhere.
 *
 * Both are 43 characters of base64url. The database keeps only a SHA-256 of
 * the token (`manage_token_hash`), so a read of the database gives neither
 * away, and the key alone makes no link without a booking's id.
 */

/** base64url of 32 bytes, without padding. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newHoldToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The link's secret of one booking under `key` (the server's secret key). */
export function manageTokenFor(bookingId: string, key: string): string {
  if (!key) throw new Error("no key for booking links");
  return createHmac("sha256", key).update(`gradus-booking-manage:${bookingId}`).digest("base64url");
}

/** Whether a string can be a token at all (checked before any hashing or lookup). */
export function isBookingToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

/** What the database stores and looks a token up by: lowercase hex SHA-256. */
export function bookingTokenHash(token: string): string {
  return createHash("sha256").update(`gradus-booking:${token}`).digest("hex");
}

/** The guest's page for one booking. */
export function managePath(token: string): string {
  return `/s/r/${token}`;
}
