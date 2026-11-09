import "server-only";
import Stripe from "stripe";
import { resolveStripeSetup, setupProblemMessage, vatModeOf, type StripeMode, type StripeSetup } from "./modes";

/**
 * The Stripe SDK, on the server only (the browser never gets more than the
 * publishable key). STRIPE_SECRET_KEY decides the mode; a key that does not
 * belong to this deployment (a test key in production, a live key anywhere
 * else) turns payments off with a clear line in the log.
 */

let logged: string | null = null;

/** The setup as the environment has it; the problem is logged once per process. */
export function stripeSetup(): StripeSetup {
  const setup = resolveStripeSetup({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
  if (!setup.ok && setup.problem !== "missing_key") {
    const message = setupProblemMessage(setup.problem, process.env.VERCEL_ENV);
    if (logged !== message) {
      logged = message;
      console.error(message);
    }
  }
  return setup;
}

const clients = new Map<string, Stripe>();

export type StripeClient = { stripe: Stripe; mode: StripeMode };

/** The SDK for the configured key, or null when payments are off (the reason is in the log). */
export function stripeClient(): StripeClient | null {
  const setup = stripeSetup();
  if (!setup.ok) return null;
  let stripe = clients.get(setup.secretKey);
  if (!stripe) {
    stripe = new Stripe(setup.secretKey, {
      appInfo: { name: "gradus" },
      maxNetworkRetries: 2,
      timeout: 20_000,
    });
    clients.set(setup.secretKey, stripe);
  }
  return { stripe, mode: setup.mode };
}

/** Logs why a payment was refused (the account's mode or the setup), never personal data. */
export function logPaymentRefused(reason: string, mode: StripeMode | null) {
  console.error(`[stripe] payment refused: ${reason}${mode ? ` (mode ${mode})` : ""}`);
}

export const vatMode = () => vatModeOf(process.env.BILLING_VAT_MODE);

/** The webhook's signing secret; null when it is not set. */
export const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
