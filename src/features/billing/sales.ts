/**
 * Whether Gradus sells for real yet (27.1): only a live publishable key
 * (pk_live_…) means payments run. Until then everything priced for a worker
 * is shown with "once payments start", because nobody pays for it yet.
 * NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is the one Stripe value the browser has.
 */
export function salesLiveForKey(publishableKey: string | null | undefined): boolean {
  return /^pk_live_[A-Za-z0-9]+/.test(publishableKey?.trim() ?? "");
}

export const salesLive = (): boolean =>
  salesLiveForKey(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
