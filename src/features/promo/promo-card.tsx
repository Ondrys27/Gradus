"use client";

import { useState } from "react";
import { TicketPercentIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { isPaidPlanKey, priceCurrencyFor, type PlanCatalog } from "@/config/pricing";
import { useUserSettings } from "@/features/account/queries";
import { promoFirstPayment } from "@/features/plan/plan";
import { money, priceOf } from "@/features/subscription/plan-price";
import { useSubscription } from "@/features/subscription/queries";
import { formatDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { PromoRedeemForm, usePromoOfferText } from "./promo-code-field";
import { useRefreshAfterPromo, usePromoStatus } from "./queries";

/**
 * Settings → Subscription: the account's promo code and what it does to
 * the first payment, priced with promoFirstPayment() as a gateway will
 * charge it; or, until the account has a code and has not paid, the field
 * to enter one. Nothing for a worker or an account that paid without a code.
 */
export function PromoCard({ plans }: { plans: PlanCatalog }) {
  const t = useTranslations("promo.card");
  const offerText = usePromoOfferText();
  const settings = useUserSettings();
  const format = useFormatSettings();
  const status = usePromoStatus();
  const subscription = useSubscription();
  const refresh = useRefreshAfterPromo();
  const [done, setDone] = useState<string | null>(null);

  const data = status.data;
  if (!data || (!data.redemption && !data.eligible)) return null;

  if (!data.redemption) {
    return (
      <GlowCard interactive={false} className="flex flex-col gap-4 md:p-6" data-testid="promo-card">
        <Header title={t("title")} description={t("description")} />
        <PromoRedeemForm
          source="settings"
          suggested={data.suggested}
          startOpen
          onRedeemed={(result) => {
            setDone(offerText(result.offer));
            void refresh();
          }}
        />
      </GlowCard>
    );
  }

  const offer = data.redemption;
  const sub = subscription.data ?? null;
  const currency = priceCurrencyFor(settings.currency);
  const plan =
    sub && isPaidPlanKey(sub.planKey) ? plans.find((p) => p.key === sub.planKey) : undefined;
  const lines: string[] = [];
  if (offer.benefit === "trial_days_extra") {
    if (sub?.status === "trialing" && sub.trialEndsAt) {
      lines.push(t("trialEnds", { date: formatDate(new Date(sub.trialEndsAt), format) }));
    }
  } else if (sub && plan && !data.paid) {
    const price = promoFirstPayment(priceOf(plan, sub.billing, currency), sub.billing, offer);
    const regular = money(price.regular, currency, format);
    if (price.freeMonths > 0) {
      lines.push(t("freeMonths", { months: price.freeMonths, regular }));
    } else if (price.first < price.regular) {
      lines.push(
        t(sub.billing === "yearly" ? "firstPaymentYearly" : "firstPayment", {
          first: money(price.first, currency, format),
          regular,
        }),
      );
    }
  } else if (sub && !plan) {
    lines.push(t("betaNote"));
  }

  return (
    <GlowCard interactive={false} className="flex flex-col gap-3 md:p-6" data-testid="promo-card">
      <Header title={t("title")} />
      {done && <FormAlert tone="success">{t("redeemed", { offer: done })}</FormAlert>}
      <p
        className="flex items-center gap-2 text-[15px] font-medium text-teal"
        data-testid="promo-offer"
      >
        <TicketPercentIcon aria-hidden className="size-4 shrink-0" />
        {offerText(offer)}
      </p>
      {lines.map((line) => (
        <p key={line} className="text-sm text-ink-soft" data-testid="promo-price">
          {line}
        </p>
      ))}
    </GlowCard>
  );
}

function Header({ title, description }: { title: string; description?: string }) {
  return (
    <header className="flex flex-col gap-1">
      <p className="micro-label">{title}</p>
      {description && <p className="max-w-2xl text-sm text-ink-soft">{description}</p>}
    </header>
  );
}
