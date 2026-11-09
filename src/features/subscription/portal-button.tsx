"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import type { PortalSource } from "@/features/billing/stripe/sources";
import { SubscriptionActionError, useOpenPortal } from "./queries";

/**
 * "Manage payment method and receipts": Stripe's Customer Portal for the
 * card, the billing address and the receipts (plans stay in Gradus). The
 * browser leaves for Stripe and comes back to Settings → Subscription.
 */
export function PortalButton({
  from,
  label,
  variant = "outline",
  size,
}: {
  from: PortalSource;
  /** Another text than "Manage payment method and receipts" (the banner's "Update card"). */
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
}) {
  const t = useTranslations("subscription");
  const open = useOpenPortal();
  const [error, setError] = useState<string | null>(null);
  const busy = open.isPending || open.isSuccess;
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={variant}
        size={size}
        disabled={busy}
        data-testid="subscription-portal"
        onClick={() => {
          setError(null);
          open.mutate(from, {
            onError: (failure) =>
              setError(t(`errors.${failure instanceof SubscriptionActionError ? failure.code : "unknown"}`)),
          });
        }}
      >
        {busy ? t("portal.redirecting") : (label ?? t("portal.open"))}
      </Button>
      {error && <FormAlert>{error}</FormAlert>}
    </div>
  );
}
