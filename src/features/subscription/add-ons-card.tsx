"use client";

import { useState } from "react";
import { PuzzleIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Switch } from "@/components/ui/switch";
import type { CatalogAddOn } from "@/config/pricing";
import { RateNote } from "@/features/currency/rate-note";
import { useExchangeRates } from "@/features/currency/use-exchange-rates";
import { planText } from "@/features/plan/catalog";
import { addOnPrice } from "@/features/plan/localized";
import { BASE_CURRENCY } from "@/lib/currency";
import { rateDate, type RateTable } from "@/lib/exchange-rates";
import { formatPrice } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { SubscriptionActionError, useSetAddOn, useSubscription } from "./queries";
import { addOnBlock, isManagedPlan, paymentRoute } from "./state";

/**
 * Settings → Subscription: the add-ons of the catalog (step 24.1), each with
 * its price in the user's currency and a switch. In Stripe the switch adds or
 * removes the add-on's item at once; during the trial it is paid with the
 * plan at Checkout; beta does not pay for it.
 */
export function AddOnsCard({
  addOns,
  currency,
  rates: initialRates,
}: {
  addOns: readonly CatalogAddOn[];
  currency: string;
  rates?: RateTable;
}) {
  const t = useTranslations("subscription");
  const locale = useLocale();
  const format = useFormatSettings();
  const rates = useExchangeRates(initialRates);
  const query = useSubscription();
  const set = useSetAddOn();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const sub = query.data;
  if (!sub) return null;

  const block = addOnBlock(sub);
  const route = paymentRoute(sub);
  const hint = !isManagedPlan(sub)
    ? "free"
    : route === "gateway"
      ? "gateway"
      : route === "checkout"
        ? "checkout"
        : "manual";

  return (
    <GlowCard interactive={false} className="flex flex-col gap-4 md:p-6" data-testid="subscription-add-ons">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <PuzzleIcon aria-hidden className="size-4 text-violet" />
          {t("addOns.title")}
        </h2>
        <p className="text-sm text-ink-soft">{t("addOns.description")}</p>
      </header>
      <ul className="flex flex-col divide-y divide-line/60">
        {addOns.map((addOn) => {
          const name = planText(addOn.name, locale);
          const price = addOnPrice(addOn, currency, rates);
          const on = sub.addOns.includes(addOn.key);
          const id = `add-on-${addOn.key}`;
          return (
            <li key={addOn.key} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor={id} className="text-[15px] font-medium text-ink">
                  {name}
                </label>
                <p className="text-sm text-ink-soft">{planText(addOn.description, locale)}</p>
                <p className="text-sm text-ink" data-testid={`${id}-price`}>
                  {t("addOns.perMonth", { price: formatPrice(price.amount, price.currency, format) })}
                </p>
                {price.origin === "derived" && rateDate(rates, price.currency) && (
                  <RateNote at={rateDate(rates, price.currency) as string} charged={BASE_CURRENCY} />
                )}
              </div>
              <Switch
                id={id}
                checked={on}
                disabled={Boolean(block) || set.isPending}
                aria-label={t("addOns.toggle", { name })}
                data-testid={`${id}-switch`}
                onCheckedChange={(checked) => {
                  setNotice(null);
                  set.mutate(
                    { addOn: addOn.key, on: checked },
                    {
                      onSuccess: () =>
                        setNotice({ tone: "success", text: t(checked ? "addOns.on" : "addOns.off", { name }) }),
                      onError: (error) =>
                        setNotice({
                          tone: "error",
                          text: t(`errors.${error instanceof SubscriptionActionError ? error.code : "unknown"}`),
                        }),
                    },
                  );
                }}
              />
            </li>
          );
        })}
      </ul>
      {block && <FormAlert>{t(`errors.${block === "expired" ? "expired" : "addOnScheduled"}`)}</FormAlert>}
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      <p className="text-xs text-ink-muted">{t(`addOns.hint.${hint}`)}</p>
    </GlowCard>
  );
}
