import type Stripe from "stripe";
import { APP_NAME } from "@/lib/constants";
import { LOCALIZED_PAGES } from "@/lib/routes";

/**
 * Stripe's Customer Portal as Gradus uses it (step 23.2): the card, the
 * billing address and the list of receipts only. Changing the plan and
 * cancelling stay off: Gradus does them by its own rules (state.ts,
 * subscription_request_change()). The configuration is made by code, the
 * same in every deployment of a mode: found by its metadata, updated when
 * its features differ, created when missing. `bun run stripe:portal` does it
 * up front; the first portal session of a process does it otherwise.
 * No server-only import: the script uses it too.
 */

/** Metadata that marks Gradus's configuration; a new version makes a new one. */
export const PORTAL_METADATA = { app: "gradus", portal: "v1" } as const;

export const PORTAL_ALLOWED_UPDATES = ["address"] as const;

export function portalFeatures(): Stripe.BillingPortal.ConfigurationCreateParams.Features {
  return {
    payment_method_update: { enabled: true },
    customer_update: { enabled: true, allowed_updates: [...PORTAL_ALLOWED_UPDATES] },
    invoice_history: { enabled: true },
    subscription_cancel: { enabled: false },
    subscription_update: { enabled: false },
  };
}

/** Terms and privacy on the site (Czech pages; the portal has its own language). */
export function portalConfigurationParams(site: string | null): Stripe.BillingPortal.ConfigurationCreateParams {
  const base = site?.replace(/\/+$/, "") || null;
  return {
    name: APP_NAME,
    features: portalFeatures(),
    ...(base
      ? {
          business_profile: {
            privacy_policy_url: `${base}${LOCALIZED_PAGES.privacy.cs}`,
            terms_of_service_url: `${base}${LOCALIZED_PAGES.terms.cs}`,
          },
        }
      : {}),
    metadata: { ...PORTAL_METADATA },
  };
}

export const isGradusPortal = (config: Pick<Stripe.BillingPortal.Configuration, "metadata">) =>
  config.metadata?.app === PORTAL_METADATA.app && config.metadata?.portal === PORTAL_METADATA.portal;

/** Whether a configuration offers exactly what Gradus wants (and nothing of the plan). */
export function portalMatches(config: Pick<Stripe.BillingPortal.Configuration, "active" | "features">): boolean {
  const f = config.features;
  const updates = [...(f.customer_update?.allowed_updates ?? [])].sort();
  return (
    config.active &&
    f.payment_method_update?.enabled === true &&
    f.invoice_history?.enabled === true &&
    f.customer_update?.enabled === true &&
    updates.join(",") === [...PORTAL_ALLOWED_UPDATES].sort().join(",") &&
    f.subscription_cancel?.enabled === false &&
    f.subscription_update?.enabled === false &&
    f.subscription_pause?.enabled !== true
  );
}

export type PortalSetup = { id: string; action: "kept" | "updated" | "created" };

/** Gradus's configuration in the key's mode: kept, put right, or made. */
export async function ensurePortalConfiguration(stripe: Stripe, site: string | null): Promise<PortalSetup> {
  const params = portalConfigurationParams(site);
  let found: Stripe.BillingPortal.Configuration | null = null;
  for await (const config of stripe.billingPortal.configurations.list({ limit: 100 })) {
    if (!isGradusPortal(config)) continue;
    if (config.active) {
      found = config;
      break;
    }
    found ??= config;
  }
  if (found) {
    if (portalMatches(found)) return { id: found.id, action: "kept" };
    const updated = await stripe.billingPortal.configurations.update(found.id, {
      active: true,
      features: params.features,
      ...(params.business_profile ? { business_profile: params.business_profile } : {}),
    });
    return { id: updated.id, action: "updated" };
  }
  const created = await stripe.billingPortal.configurations.create(params, {
    idempotencyKey: `portal:${PORTAL_METADATA.portal}`,
  });
  return { id: created.id, action: "created" };
}
