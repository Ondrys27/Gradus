import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The round trip to Google's consent page (28.10): a random `state` and a
 * PKCE verifier kept in a short httpOnly cookie, bound to the account that
 * started it. The callback accepts only the same state from the same account
 * within 10 minutes.
 */

export const OAUTH_COOKIE = "gradus_gcal_oauth";
export const OAUTH_COOKIE_PATH = "/api/integrations/google";
export const OAUTH_MAX_AGE_S = 600;

/**
 * Where the round trip returns: Settings → Calendar, or the scheduler's
 * Availability when the connection was started there (30.4).
 */
export const OAUTH_BACKS = ["settings", "scheduler"] as const;
export type OAuthBack = (typeof OAUTH_BACKS)[number];

export function isOAuthBack(value: unknown): value is OAuthBack {
  return typeof value === "string" && (OAUTH_BACKS as readonly string[]).includes(value);
}

export type OAuthState = {
  state: string;
  verifier: string;
  userId: string;
  at: number;
  back?: OAuthBack;
};

export function newOAuthState(
  userId: string,
  now = Date.now(),
  back: OAuthBack = "settings",
): OAuthState {
  return {
    state: randomBytes(24).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    userId,
    at: now,
    ...(back === "settings" ? {} : { back }),
  };
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function encodeOAuthState(value: OAuthState): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeOAuthState(raw: string | undefined | null): OAuthState | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      typeof value.state === "string" &&
      typeof value.verifier === "string" &&
      typeof value.userId === "string" &&
      typeof value.at === "number"
    ) {
      return {
        state: value.state,
        verifier: value.verifier,
        userId: value.userId,
        at: value.at,
        ...(isOAuthBack(value.back) && value.back !== "settings" ? { back: value.back } : {}),
      };
    }
  } catch {
    // A broken cookie is no state.
  }
  return null;
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** Whether the callback belongs to the round trip this account started. */
export function oauthStateMatches(
  stored: OAuthState | null,
  input: { state: string | null; userId: string | null },
  now = Date.now(),
): boolean {
  if (!stored || !input.state || !input.userId) return false;
  if (now - stored.at > OAUTH_MAX_AGE_S * 1000 || now < stored.at - 60_000) return false;
  return same(stored.state, input.state) && same(stored.userId, input.userId);
}
