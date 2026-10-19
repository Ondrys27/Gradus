import { createHash, randomBytes } from "node:crypto";

/**
 * The secret in an invitation link to the administration: 32 random bytes,
 * base64url (43 characters). Only its SHA-256 goes to the database, so the
 * table alone never lets anyone in.
 */

export const ADMIN_INVITE_TTL_DAYS = 7;
export const ADMIN_INVITE_TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateInviteToken(): string {
  return randomBytes(ADMIN_INVITE_TOKEN_BYTES).toString("base64url");
}

/** Shape only; says nothing about whether such an invitation exists. */
export function isWellFormedInviteToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

/** Hex SHA-256, the only form the database knows. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type InviteRow = {
  accepted_at: string | null;
  revoked_at: string | null;
  expires_at: string;
};

export type InviteState = "open" | "accepted" | "revoked" | "expired";

export function inviteState(row: InviteRow, now: Date = new Date()): InviteState {
  if (row.accepted_at) return "accepted";
  if (row.revoked_at) return "revoked";
  return new Date(row.expires_at).getTime() > now.getTime() ? "open" : "expired";
}

export function inviteExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + ADMIN_INVITE_TTL_DAYS * 86_400_000);
}
