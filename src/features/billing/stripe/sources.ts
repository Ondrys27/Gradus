/** Where an owner started paying: Settings → Subscription, the trial's last days, the read-only card. */
export const CHECKOUT_SOURCES = ["settings", "trial_banner", "read_only"] as const;
export type CheckoutSource = (typeof CHECKOUT_SOURCES)[number];

/** Where an owner opened Stripe's Customer Portal: Settings → Subscription, the past-due banner. */
export const PORTAL_SOURCES = ["settings", "past_due_banner"] as const;
export type PortalSource = (typeof PORTAL_SOURCES)[number];
