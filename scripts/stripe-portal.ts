/**
 * `bun run stripe:portal`: makes or puts right Gradus's Customer Portal
 * configuration in the mode of STRIPE_SECRET_KEY (step 23.2): the card, the
 * billing address and the list of receipts only; changing the plan and
 * cancelling stay off. Safe to run any number of times. Bun reads .env and
 * .env.local; for the live mode run it with the live key in the environment:
 *   STRIPE_SECRET_KEY=sk_live_… bun run stripe:portal
 * The app does the same on the first portal session of a process, so this
 * is only to have it ready (and to see it) up front. Prints no secret.
 */
import Stripe from "stripe";
import { ensurePortalConfiguration } from "../src/features/billing/stripe/portal";
import { stripeModeOfKey } from "../src/features/billing/stripe/modes";

const key = process.env.STRIPE_SECRET_KEY?.trim();
const mode = stripeModeOfKey(key);
if (!key || !mode) {
  console.error("STRIPE_SECRET_KEY is missing or is neither a test nor a live key (sk_test_… / sk_live_…).");
  process.exit(1);
}

const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || null;
const stripe = new Stripe(key, { appInfo: { name: "gradus" }, maxNetworkRetries: 2 });
const setup = await ensurePortalConfiguration(stripe, site);
console.info(`Customer Portal (${mode} mode): ${setup.action} ${setup.id}`);
if (!site) console.info("NEXT_PUBLIC_SITE_URL is not set: the portal shows no links to the terms and privacy pages.");
