/** Where an owner started paying: Settings → Subscription, the trial's last days, the read-only card. */
export const CHECKOUT_SOURCES = ["settings", "trial_banner", "read_only"] as const;
export type CheckoutSource = (typeof CHECKOUT_SOURCES)[number];
