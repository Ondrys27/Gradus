/**
 * The red badge of new errors (29.2): at Operations → Errors in the menu, in
 * the tab's title and on the bell, instead of an e-mail. "New" is the log's
 * state New (27.2) of an error that happened in the last ERROR_BADGE_DAYS
 * days, so an old one that stopped happening fades out on its own.
 */

export const ERROR_BADGE_DAYS = 30;
/** How often an open administration asks, while its tab is visible. */
export const ERROR_BADGE_POLL_MS = 60_000;
/** The badge shows at most this, then "99+". */
export const ERROR_BADGE_MAX = 99;

export type ErrorBadge = {
  count: number;
  latest: {
    fingerprint: string;
    code: string;
    message: string;
    page: string;
    lastAt: string;
    returned: boolean;
  }[];
};

export function badgeText(count: number): string {
  return count > ERROR_BADGE_MAX ? `${ERROR_BADGE_MAX}+` : String(count);
}

/** The tab's title with the count in front, "(3) Overview · …"; without new errors unchanged. */
export function titleWithCount(title: string, count: number): string {
  const bare = title.replace(/^\(\d+\+?\)\s/, "");
  return count > 0 ? `(${badgeText(count)}) ${bare}` : bare;
}
