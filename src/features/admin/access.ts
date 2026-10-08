/**
 * Rules of access to the administration that need no database: addresses,
 * the shape of the signed token, the attempt limit and the idle timer. The
 * database function admin_session_touch() makes the final decision.
 */

export const ADMIN_PATH = "/admin";
export const ADMIN_LOGIN_PATH = "/admin/prihlaseni";
/**
 * Where the middleware rewrites anyone who may not see the administration.
 * No page lives here, so the answer is the site's ordinary 404.
 */
export const ADMIN_NOT_FOUND_PATH = "/__not-found";

export const ADMIN_IDLE_MS = 30 * 60_000;
export const ADMIN_MAX_SESSION_MS = 8 * 60 * 60_000;
/** Password and code must follow each other within this time. */
export const ADMIN_FRESH_SIGN_IN_SECONDS = 10 * 60;
/** How often the open page tells the server the owner is still working. */
export const ADMIN_HEARTBEAT_MS = 5 * 60_000;

export const ADMIN_MAX_FAILURES = 5;
export const ADMIN_LOCKOUT_MS = 15 * 60_000;
/** How far back attempts are read; enough to see any lock still running. */
export const ADMIN_ATTEMPTS_LOOKBACK_MS = 60 * 60_000;

export type AdminSessionStatus = "ok" | "denied" | "idle" | "expired" | "ended";

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_PATH || pathname.startsWith(`${ADMIN_PATH}/`);
}

export function isAdminLoginPath(pathname: string): boolean {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return clean === ADMIN_LOGIN_PATH;
}

type AmrEntry = { method: string; timestamp: number };
export type AdminClaims = {
  sub?: string;
  aal?: string;
  session_id?: string;
  email?: string;
  amr?: unknown;
};

function amrEntries(amr: unknown): AmrEntry[] {
  if (!Array.isArray(amr)) return [];
  return amr.filter(
    (entry): entry is AmrEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as AmrEntry).method === "string" &&
      typeof (entry as AmrEntry).timestamp === "number",
  );
}

/** Seconds since `method` was last used in this session, or null. */
function methodAge(claims: AdminClaims, method: string, nowSeconds: number): number | null {
  const times = amrEntries(claims.amr)
    .filter((entry) => entry.method === method)
    .map((entry) => entry.timestamp);
  return times.length ? nowSeconds - Math.max(...times) : null;
}

/**
 * The token alone can already say no: no user, or no second factor. Saves the
 * database call for nearly every stranger; a yes still goes to the database.
 */
export function claimsMayEnterAdmin(claims: AdminClaims | null | undefined): boolean {
  return Boolean(claims?.sub) && claims?.aal === "aal2" && Boolean(claims?.session_id);
}

/** The password was entered on the admin sign-in page a moment ago, in this session. */
export function isFreshPasswordSession(
  claims: AdminClaims | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!claims?.sub) return false;
  const age = methodAge(claims, "password", nowSeconds);
  return age !== null && age >= -60 && age <= ADMIN_FRESH_SIGN_IN_SECONDS;
}

/** The code was entered a moment ago, in this session (adding a backup device). */
export function isFreshTotpSession(
  claims: AdminClaims | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!claims?.sub || claims.aal !== "aal2") return false;
  const age = methodAge(claims, "totp", nowSeconds);
  return age !== null && age >= -60 && age <= ADMIN_FRESH_SIGN_IN_SECONDS;
}

export type LoginAttempt = { at: Date | string; success: boolean };

/**
 * When the pause after too many wrong attempts ends, or null when there is
 * none. Five failures within 15 minutes start a 15-minute pause; a complete
 * sign-in (password and code) clears the count. Attempts during a pause are
 * refused before they are recorded, so they never extend it.
 */
export function lockedUntil(
  attempts: readonly LoginAttempt[],
  now: Date = new Date(),
): Date | null {
  const sorted = attempts
    .map((attempt) => ({ at: new Date(attempt.at).getTime(), success: attempt.success }))
    .filter((attempt) => Number.isFinite(attempt.at))
    .sort((a, b) => a.at - b.at);
  let failures: number[] = [];
  let lockEnd = 0;
  for (const attempt of sorted) {
    if (attempt.at < lockEnd) continue;
    if (attempt.success) {
      failures = [];
      continue;
    }
    failures = failures.filter((at) => attempt.at - at < ADMIN_LOCKOUT_MS);
    failures.push(attempt.at);
    if (failures.length >= ADMIN_MAX_FAILURES) {
      lockEnd = attempt.at + ADMIN_LOCKOUT_MS;
      failures = [];
    }
  }
  return lockEnd > now.getTime() ? new Date(lockEnd) : null;
}

/** Whole minutes left of a pause, at least one. */
export function minutesLeft(until: Date, now: Date = new Date()): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
}

export type IdleStep = "end" | "heartbeat" | "wait";

/**
 * What the open administration does on each tick: leave after 30 minutes
 * without input or at the 8-hour limit, tell the server about recent input
 * now and then, otherwise nothing.
 */
export function idleStep(input: {
  now: number;
  lastActivity: number;
  lastHeartbeat: number;
  expiresAt: number;
}): IdleStep {
  if (input.now >= input.expiresAt) return "end";
  if (input.now - input.lastActivity >= ADMIN_IDLE_MS) return "end";
  if (
    input.lastActivity > input.lastHeartbeat &&
    input.now - input.lastHeartbeat >= ADMIN_HEARTBEAT_MS
  ) {
    return "heartbeat";
  }
  return "wait";
}

export function parseSessionStatus(data: unknown): {
  status: AdminSessionStatus;
  userId: string | null;
  expiresAt: string | null;
} {
  const value = (data ?? {}) as { status?: unknown; user_id?: unknown; expires_at?: unknown };
  const status = (["ok", "idle", "expired", "ended"] as const).find((s) => s === value.status);
  return {
    status: status ?? "denied",
    userId: typeof value.user_id === "string" ? value.user_id : null,
    expiresAt: typeof value.expires_at === "string" ? value.expires_at : null,
  };
}

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
function csvCell(value: string | number | null | undefined): string {
  if (typeof value === "number") return String(value);
  let text = value === null || value === undefined ? "" : value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
) {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
