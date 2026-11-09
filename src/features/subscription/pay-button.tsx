"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import type { Billing, PaidPlanKey } from "@/config/pricing";
import type { CheckoutSource } from "@/features/billing/stripe/sources";
import { SubscriptionActionError, useStartCheckout } from "./queries";

/**
 * "Pay and continue": a Stripe Checkout of the plan, from Settings →
 * Subscription, the trial's last days or the read-only card. The browser
 * leaves for Stripe's page; the webhook records the outcome.
 */
export function PayButton({
  planKey,
  billing,
  from,
  size,
  className,
}: {
  planKey: PaidPlanKey;
  billing: Billing;
  from: CheckoutSource;
  size?: "sm" | "default";
  className?: string;
}) {
  const t = useTranslations("subscription");
  const start = useStartCheckout();
  const [error, setError] = useState<string | null>(null);
  const busy = start.isPending || start.isSuccess;
  return (
    <div className="flex flex-col gap-2">
      <Button
        size={size}
        className={className}
        disabled={busy}
        data-testid="subscription-pay"
        onClick={() => {
          setError(null);
          start.mutate(
            { planKey, billing, from },
            {
              onError: (failure) =>
                setError(
                  t(`errors.${failure instanceof SubscriptionActionError ? failure.code : "unknown"}`),
                ),
            },
          );
        }}
      >
        {busy ? t("checkout.redirecting") : t("pay")}
      </Button>
      {error && <FormAlert>{error}</FormAlert>}
    </div>
  );
}

/** The browser's hint that payments run here (the publishable key is the only Stripe value it has). */
export const paymentsInBrowser = () => Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
