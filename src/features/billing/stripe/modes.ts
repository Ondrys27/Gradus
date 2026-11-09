/**
 * Stripe's two modes and who may use which (step 23.1). The database is one
 * for development and production, Stripe has a test and a live mode: the
 * secret key says which one the server talks to, production takes only a
 * live key and every other deployment only a test key, the test mode changes
 * only internal accounts (the owner, the demo account and every
 * @gradus.local address) and the live mode only the others. The database
 * checks the accounts the same way in billing_mode_allowed().
 */

export const STRIPE_MODES = ["test", "live"] as const;
export type StripeMode = (typeof STRIPE_MODES)[number];

export const isStripeMode = (value: unknown): value is StripeMode =>
  value === "test" || value === "live";

/** The mode of a secret or restricted key; null for anything else. */
export function stripeModeOfKey(key: string | null | undefined): StripeMode | null {
  const value = key?.trim() ?? "";
  if (/^(sk|rk)_test_[A-Za-z0-9]+/.test(value)) return "test";
  if (/^(sk|rk)_live_[A-Za-z0-9]+/.test(value)) return "live";
  return null;
}

/** The mode a deployment may use: live in production, test everywhere else. */
export function modeForEnv(vercelEnv: string | undefined): StripeMode {
  return vercelEnv === "production" ? "live" : "test";
}

export const modeAllowedInEnv = (mode: StripeMode, vercelEnv: string | undefined) =>
  mode === modeForEnv(vercelEnv);

export const eventMode = (livemode: boolean): StripeMode => (livemode ? "live" : "test");

const LOCAL_EMAIL = /@gradus\.local$/i;

/** The test and demo accounts' domain: nobody needs to hear about their payments. */
export const isLocalEmail = (email: string | null | undefined) => !!email && LOCAL_EMAIL.test(email.trim());

/** As billing_mode_allowed(): test for internal and @gradus.local accounts, live for the rest. */
export function accountAllowedInMode(
  mode: StripeMode,
  account: { email: string | null; internal: boolean },
): boolean {
  const local = isLocalEmail(account.email);
  return mode === "test" ? account.internal || local : !account.internal && !local;
}

export type StripeSetupProblem = "missing_key" | "unknown_key" | "wrong_env_key";

export type StripeSetup =
  | { ok: true; mode: StripeMode; secretKey: string }
  | { ok: false; problem: StripeSetupProblem; mode: StripeMode | null };

/** Whether the server may talk to Stripe at all, and in which mode. */
export function resolveStripeSetup(env: {
  STRIPE_SECRET_KEY?: string;
  VERCEL_ENV?: string;
}): StripeSetup {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return { ok: false, problem: "missing_key", mode: null };
  const mode = stripeModeOfKey(secretKey);
  if (!mode) return { ok: false, problem: "unknown_key", mode: null };
  if (!modeAllowedInEnv(mode, env.VERCEL_ENV)) return { ok: false, problem: "wrong_env_key", mode };
  return { ok: true, mode, secretKey };
}

/** The log line that says what is wrong with the setup, without the key itself. */
export function setupProblemMessage(problem: StripeSetupProblem, vercelEnv: string | undefined): string {
  switch (problem) {
    case "missing_key":
      return "[stripe] STRIPE_SECRET_KEY is not set: payments are off.";
    case "unknown_key":
      return "[stripe] STRIPE_SECRET_KEY is neither a test nor a live key (sk_test_… / sk_live_…): payments refused.";
    case "wrong_env_key":
      return vercelEnv === "production"
        ? "[stripe] Production takes only a live key (sk_live_…), STRIPE_SECRET_KEY is a test key: payments refused."
        : `[stripe] ${vercelEnv ?? "development"} takes only a test key (sk_test_…), STRIPE_SECRET_KEY is a live key: payments refused.`;
  }
}

/** BILLING_VAT_MODE: catalog prices are final (none) until Stripe Tax is switched on. */
export const VAT_MODES = ["none", "stripe_tax"] as const;
export type VatMode = (typeof VAT_MODES)[number];
export const vatModeOf = (value: string | undefined): VatMode =>
  value?.trim() === "stripe_tax" ? "stripe_tax" : "none";

/**
 * A synthetic event of the end-to-end tests: signed with the test webhook
 * secret, never live, never in production, and its id says so. Its objects
 * are taken as they are instead of being loaded from Stripe (no network).
 */
export function isSyntheticE2eEvent(
  event: { id: string; livemode: boolean },
  vercelEnv: string | undefined,
): boolean {
  return vercelEnv !== "production" && !event.livemode && event.id.startsWith("evt_e2e_");
}
