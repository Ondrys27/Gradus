/**
 * "Only critical" e-mails about errors (29.2). The database decides
 * (error_alert_critical in 20261206090000_admin_dashboard.sql); these are
 * the same rules, for the texts and a test that the two stay the same:
 *
 *   * the same error (fingerprint) at CRITICAL_USERS or more signed-in
 *     people within the last hour, or
 *   * a crash where it hurts most: signing in, signing up, payments
 *     (the page or the route matches CRITICAL_PLACE_PATTERN, or the cron
 *     job of payments).
 */

export const CRITICAL_USERS = 5;

/** Pages and routes of signing in, signing up and paying (ids are already out of the page). */
export const CRITICAL_PLACE_PATTERN =
  "^/(en/)?(prihlaseni|login|registrace|register|nove-heslo|reset-password|zapomenute-heslo|forgot-password|admin/prihlaseni|auth|api/stripe|api/cron/recurring-payments|app/nastaveni/predplatne)(/|$)";

const PLACE = new RegExp(CRITICAL_PLACE_PATTERN);
/** The cron job of payments (its name, the `action` of a cron error). */
export const CRITICAL_CRON_JOB = "recurring_payments";

/** Whether an error's place alone makes it critical. */
export function isCriticalPlace(page: string | null, action: string | null): boolean {
  return PLACE.test(page ?? "") || PLACE.test(action ?? "") || action === CRITICAL_CRON_JOB;
}
