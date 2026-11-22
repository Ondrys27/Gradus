/**
 * WORKER_BILLING_VISIBLE (28.1): whether the app says anything about paying
 * for workers (the seat chips in Company, the Workers line of the
 * subscription, the per-worker price of a plan, the line in the invite
 * e-mail) and whether Stripe charges extra workers. Off until the owner
 * turns it on: app_settings 'worker_billing' = { "visible": true }. The
 * arithmetic (worker-seats.ts) stays as it is, only nobody sees or pays it.
 */
export const WORKER_BILLING_SETTING_KEY = "worker_billing";

/** The value of the switch; anything but `{ visible: true }` (no row included) is hidden. */
export function readWorkerBillingSetting(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).visible === true
  );
}
