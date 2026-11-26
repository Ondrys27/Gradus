/**
 * A page left open across a deployment asks for code that is gone (a chunk,
 * a server action). The fix is the new version: the page reloads itself,
 * quietly, once. A second failure within RELOAD_GUARD_MS is no longer an old
 * page (the new one fails too) and is recorded like any other error.
 */

export const RELOAD_GUARD_MS = 60_000;
const KEY = "gradus.staleReloadAt";

/** Whether a reload may happen now, given when the last one was (pure, for the tests). */
export function mayReload(lastAt: number | null, now: number): boolean {
  return lastAt === null || !Number.isFinite(lastAt) || now - lastAt > RELOAD_GUARD_MS;
}

/** Reloads the page for the new version; false when it already did a moment ago. */
export function reloadForNewVersion(): boolean {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const now = Date.now();
    if (!mayReload(raw === null ? null : Number(raw), now)) return false;
    window.sessionStorage.setItem(KEY, String(now));
  } catch {
    // No storage (private mode): reload anyway, the browser still stops a loop on the next load.
  }
  window.location.reload();
  return true;
}
