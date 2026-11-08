import { useState } from "react";
import { TicketPercentIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PromoRedeemForm, usePromoOfferText } from "@/features/promo/promo-code-field";
import { useRefreshAfterPromo, usePromoStatus } from "@/features/promo/queries";
import { APP_NAME } from "@/lib/constants";
import { StepShell } from "../step-shell";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const t = useTranslations("onboarding.welcome");
  const tActions = useTranslations("onboarding.actions");
  return (
    <StepShell
      jarvisState="happy"
      title={t("title", { appName: APP_NAME })}
      description={t("description", { appName: APP_NAME })}
      footer={
        <Button type="button" size="lg" autoFocus onClick={onNext} className="w-full sm:w-auto">
          {tActions("start")}
        </Button>
      }
    >
      <WelcomePromo />
    </StepShell>
  );
}

/**
 * „Máš kód?" for an owner who registered without one (a partner's link may
 * have prefilled it since); the code the account already uses otherwise.
 * Nothing while the status loads, for a worker, or after a payment.
 */
function WelcomePromo() {
  const status = usePromoStatus();
  const refresh = useRefreshAfterPromo();
  const offerText = usePromoOfferText();
  const [redeemed, setRedeemed] = useState<string | null>(null);
  const data = status.data;
  const used = redeemed ?? (data?.redemption ? offerText(data.redemption) : null);
  if (!used && !data?.eligible) return null;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-2 pt-2">
      {used ? (
        <p
          className="flex items-center gap-2 text-sm font-medium text-teal"
          data-testid="promo-offer"
        >
          <TicketPercentIcon aria-hidden className="size-4 shrink-0" />
          {used}
        </p>
      ) : (
        <PromoRedeemForm
          source="signup"
          suggested={data?.suggested}
          onRedeemed={(result) => {
            setRedeemed(offerText(result.offer));
            void refresh();
          }}
        />
      )}
    </div>
  );
}
