import type { StripeMode } from "./modes";

/**
 * Links from the administration to Stripe's dashboard (step 23.2): the test
 * mode's pages live under /test, the live mode's at the root. Only ids of
 * the shape Stripe gives go into a link; anything else is no link.
 */

const DASHBOARD = "https://dashboard.stripe.com";

const PATHS = {
  customer: { prefix: "cus_", path: "customers" },
  subscription: { prefix: "sub_", path: "subscriptions" },
  invoice: { prefix: "in_", path: "invoices" },
} as const;

export type DashboardObject = keyof typeof PATHS;

export function stripeDashboardUrl(mode: StripeMode, object: DashboardObject, id: string | null | undefined): string | null {
  const { prefix, path } = PATHS[object];
  if (!id || !id.startsWith(prefix) || !/^[A-Za-z0-9_]{4,200}$/.test(id)) return null;
  // The end-to-end tests' synthetic objects exist only in the database.
  if (id.startsWith(`${prefix}e2e_`)) return null;
  return `${DASHBOARD}${mode === "test" ? "/test" : ""}/${path}/${id}`;
}
