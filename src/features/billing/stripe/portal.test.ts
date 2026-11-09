import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  ensurePortalConfiguration,
  isGradusPortal,
  PORTAL_METADATA,
  portalConfigurationParams,
  portalMatches,
} from "./portal";
import { stripeDashboardUrl } from "./dashboard";

/** The Customer Portal offers the card, the billing address and receipts; never the plan or cancelling. */

type Config = Stripe.BillingPortal.Configuration;

function config(overrides: Partial<Config> = {}, features: Record<string, unknown> = {}): Config {
  const params = portalConfigurationParams("https://gradus.test");
  return {
    id: "bpc_1",
    object: "billing_portal.configuration",
    active: true,
    metadata: { ...PORTAL_METADATA },
    features: {
      ...params.features,
      customer_update: { enabled: true, allowed_updates: ["address"] },
      subscription_pause: { enabled: false },
      ...features,
    },
    ...overrides,
  } as unknown as Config;
}

function fakeStripe(existing: Config[]) {
  const create = vi.fn(async (params: Stripe.BillingPortal.ConfigurationCreateParams) => ({
    ...config(),
    id: "bpc_new",
    features: params.features,
  }));
  const update = vi.fn(async (...args: [string, Stripe.BillingPortal.ConfigurationUpdateParams]) => ({
    ...config(),
    id: args[0],
  }));
  const list = () => ({
    async *[Symbol.asyncIterator]() {
      yield* existing;
    },
  });
  return {
    stripe: { billingPortal: { configurations: { list, create, update } } } as unknown as Stripe,
    create,
    update,
  };
}

describe("the portal configuration", () => {
  it("turns on the card, the address and receipts, and off changing or cancelling the plan", () => {
    const params = portalConfigurationParams("https://gradus.test/");
    expect(params.features).toEqual({
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["address"] },
      invoice_history: { enabled: true },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
    });
    expect(params.business_profile).toEqual({
      privacy_policy_url: "https://gradus.test/soukromi",
      terms_of_service_url: "https://gradus.test/podminky",
    });
    expect(params.metadata).toEqual(PORTAL_METADATA);
    expect(portalConfigurationParams(null).business_profile).toBeUndefined();
  });

  it("accepts only exactly that", () => {
    expect(portalMatches(config())).toBe(true);
    expect(portalMatches(config({}, { subscription_cancel: { enabled: true } }))).toBe(false);
    expect(portalMatches(config({}, { subscription_update: { enabled: true } }))).toBe(false);
    expect(portalMatches(config({}, { subscription_pause: { enabled: true } }))).toBe(false);
    expect(portalMatches(config({}, { customer_update: { enabled: true, allowed_updates: ["address", "email"] } }))).toBe(
      false,
    );
    expect(portalMatches(config({ active: false }))).toBe(false);
    expect(isGradusPortal({ metadata: { app: "other" } })).toBe(false);
  });

  it("keeps a matching configuration, puts a changed one right and makes a missing one", async () => {
    const kept = fakeStripe([config({ id: "bpc_other", metadata: {} }), config({ id: "bpc_ok" })]);
    expect(await ensurePortalConfiguration(kept.stripe, null)).toEqual({ id: "bpc_ok", action: "kept" });
    expect(kept.create).not.toHaveBeenCalled();

    const changed = fakeStripe([config({ id: "bpc_drift" }, { subscription_cancel: { enabled: true } })]);
    expect(await ensurePortalConfiguration(changed.stripe, null)).toEqual({ id: "bpc_drift", action: "updated" });
    expect(changed.update.mock.calls[0]?.[1]).toMatchObject({ active: true, features: { subscription_cancel: { enabled: false } } });

    const missing = fakeStripe([config({ id: "bpc_default", metadata: {} })]);
    expect(await ensurePortalConfiguration(missing.stripe, null)).toEqual({ id: "bpc_new", action: "created" });
  });
});

describe("links to Stripe's dashboard", () => {
  it("goes to /test for the test mode and the root for live, only for ids of the right shape", () => {
    expect(stripeDashboardUrl("test", "customer", "cus_123ABC")).toBe("https://dashboard.stripe.com/test/customers/cus_123ABC");
    expect(stripeDashboardUrl("live", "subscription", "sub_9Z")).toBe("https://dashboard.stripe.com/subscriptions/sub_9Z");
    expect(stripeDashboardUrl("live", "invoice", "in_1X")).toBe("https://dashboard.stripe.com/invoices/in_1X");
    expect(stripeDashboardUrl("test", "customer", "sub_123")).toBeNull();
    expect(stripeDashboardUrl("test", "customer", "cus_../../x")).toBeNull();
    expect(stripeDashboardUrl("test", "subscription", "sub_e2e_abc")).toBeNull();
    expect(stripeDashboardUrl("test", "customer", null)).toBeNull();
  });
});
