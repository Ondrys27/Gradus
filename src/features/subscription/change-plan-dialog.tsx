"use client";

import { useState, type ReactNode } from "react";
import { ArrowRightIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  priceCurrencyFor,
  type CatalogPlan,
  type PaidPlanKey,
  type PlanCatalog,
} from "@/config/pricing";
import { useUserSettings } from "@/features/account/queries";
import { PricingCards } from "@/features/marketing/pricing-cards";
import { planText } from "@/features/plan/catalog";
import { formatDate, formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { SubscriptionActionError, usePlanUsage, useRequestChange } from "./queries";
import {
  isExpired,
  limitOverages,
  plannedChange,
  type PlanChoice,
  type Subscription,
} from "./state";
import { PayButton } from "./pay-button";
import { PlanPrice } from "./plan-price";

/**
 * Changing the plan: the three plans of the published catalog side by side
 * with a monthly / yearly switch, then a confirmation that says when the
 * change applies (up now, down at the end of the period) and what of the
 * account's data the new plan would not hold. While nothing runs in Stripe
 * (`checkout`: the trial, or it ended) the confirmation pays for the chosen
 * plan through Stripe's Checkout instead.
 */
export function ChangePlanDialog({
  open,
  onOpenChange,
  subscription,
  plans,
  checkout = false,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: Subscription & { planKey: PaidPlanKey };
  plans: PlanCatalog;
  checkout?: boolean;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("subscription.change");
  const [choice, setChoice] = useState<PlanChoice | null>(null);
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) setChoice(null);
  };
  const target = choice && plans.find((plan) => plan.key === choice.planKey);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={close}
      title={choice ? t("confirmTitle") : t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,1040px)]"
    >
      {choice && target ? (
        <Confirm
          subscription={subscription}
          plans={plans}
          target={target}
          choice={choice}
          checkout={checkout}
          onBack={() => setChoice(null)}
          onDone={(message) => {
            close(false);
            onDone(message);
          }}
        />
      ) : (
        <Picker subscription={subscription} plans={plans} checkout={checkout} onPick={setChoice} />
      )}
    </ResponsiveDialog>
  );
}

function Picker({
  subscription,
  plans,
  checkout,
  onPick,
}: {
  subscription: Subscription & { planKey: PaidPlanKey };
  plans: PlanCatalog;
  checkout: boolean;
  onPick: (choice: PlanChoice) => void;
}) {
  const t = useTranslations("subscription.change");
  const settings = useUserSettings();
  const format = useFormatSettings();
  return (
    <PricingCards
      plans={plans}
      currency={priceCurrencyFor(settings.currency)}
      formatSettings={format}
      initialBilling={subscription.billing}
      footnote={<p className="text-center text-sm text-ink-muted">{t("footnote")}</p>}
      flat
      action={(plan, billing) =>
        plan.key === subscription.planKey && billing === subscription.billing && !checkout ? (
          <Button variant="outline" className="w-full" disabled>
            {t("currentPlan")}
          </Button>
        ) : (
          <Button
            variant={plan.recommended ? "default" : "outline"}
            className="w-full"
            data-testid={`subscription-pick-${plan.key}`}
            onClick={() => onPick({ planKey: plan.key, billing })}
          >
            {t("choose")}
          </Button>
        )
      }
    />
  );
}

function Confirm({
  subscription,
  plans,
  target,
  choice,
  checkout,
  onBack,
  onDone,
}: {
  subscription: Subscription & { planKey: PaidPlanKey };
  plans: PlanCatalog;
  target: CatalogPlan;
  choice: PlanChoice;
  checkout: boolean;
  onBack: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("subscription");
  const tPlans = useTranslations("plans");
  const locale = useLocale();
  const settings = useUserSettings();
  const format = useFormatSettings();
  const currency = priceCurrencyFor(settings.currency);
  const request = useRequestChange();
  const usage = usePlanUsage(true);
  const [error, setError] = useState<string | null>(null);

  const current = plans.find((plan) => plan.key === subscription.planKey);
  const planned = plannedChange(subscription, choice);
  const targetName = planText(target.name, locale);
  const date = (at: string | null) => (at ? formatDate(new Date(at), format) : "");
  const count = (value: number) => formatNumber(value, {}, format);
  const overages = usage.data ? limitOverages(target.limits, usage.data) : [];
  const locks = overages.some((item) => item.locks);

  function confirm() {
    setError(null);
    request.mutate(choice, {
      onSuccess: (outcome) => {
        onDone(
          outcome.timing === "scheduled"
            ? t("notices.scheduled", { plan: targetName, date: date(outcome.at) })
            : outcome.timing === "none"
              ? t("notices.unscheduled")
              : t("notices.immediate", { plan: targetName }),
        );
      },
      onError: (failure) =>
        setError(
          t(`errors.${failure instanceof SubscriptionActionError ? failure.code : "unknown"}`),
        ),
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="subscription-confirm">
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <Side label={t("change.from")}>
          <p className="font-semibold text-ink">
            {current ? planText(current.name, locale) : subscription.planKey} ·{" "}
            {tPlans(`billing.${subscription.billing}`)}
          </p>
          {current && (
            <PlanPrice plan={current} billing={subscription.billing} currency={currency} format={format} />
          )}
        </Side>
        <ArrowRightIcon aria-hidden className="mx-auto hidden size-5 text-ink-muted sm:block" />
        <Side label={t("change.to")} highlight>
          <p className="font-semibold text-ink">
            {targetName} · {tPlans(`billing.${choice.billing}`)}
          </p>
          <PlanPrice plan={target} billing={choice.billing} currency={currency} format={format} />
        </Side>
      </div>

      <p className="text-sm text-ink-soft" data-testid="subscription-timing">
        {checkout
          ? !isExpired(subscription) && subscription.status === "trialing" && subscription.trialEndsAt
            ? t("checkout.trialStart", { date: date(subscription.trialEndsAt) })
            : t("checkout.nowStart")
          : planned.timing === "scheduled"
          ? t("change.scheduled", { date: date(planned.at) })
          : subscription.status === "trialing" && subscription.trialEndsAt
            ? t("change.trialImmediate", { date: date(subscription.trialEndsAt) })
            : t("change.immediate")}
      </p>

      <section className="flex flex-col gap-2" aria-live="polite">
        {usage.isPending ? (
          <p className="text-sm text-ink-muted">{t("change.overLoading")}</p>
        ) : usage.isError ? (
          <p className="text-sm text-ink-muted">{t("change.overFailed")}</p>
        ) : overages.length === 0 ? (
          planned.direction === "downgrade" && (
            <p className="text-sm text-ink-soft">{t("change.overNone", { plan: targetName })}</p>
          )
        ) : (
          <div
            className="flex flex-col gap-2 rounded-xl border border-orange/40 bg-orange/10 px-4 py-3"
            data-testid="subscription-overages"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <TriangleAlertIcon aria-hidden className="size-4 text-orange" />
              {t("change.overTitle", { plan: targetName })}
            </p>
            <ul className="flex flex-col gap-1 text-sm text-ink-soft">
              {overages.map((item) => (
                <li key={item.limit} className="flex items-start gap-2">
                  {item.locks && <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-orange" />}
                  {t(`change.over.${item.limit}`, { used: count(item.used), allowed: count(item.allowed) })}
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-muted">
              {locks ? t("change.locksNote") : t("change.monthlyNote")}
            </p>
          </div>
        )}
      </section>

      {error && <FormAlert>{error}</FormAlert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onBack} disabled={request.isPending}>
          {t("change.back")}
        </Button>
        {checkout ? (
          <PayButton planKey={choice.planKey} billing={choice.billing} from="settings" />
        ) : (
          <Button onClick={confirm} disabled={request.isPending} data-testid="subscription-confirm-change">
            {t("change.confirm")}
          </Button>
        )}
      </div>
    </div>
  );
}

function Side({
  label,
  highlight = false,
  children,
}: {
  label: string;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        highlight
          ? "flex flex-col gap-1 rounded-xl border border-violet/50 bg-violet/10 px-4 py-3"
          : "flex flex-col gap-1 rounded-xl border border-line bg-canvas-deep/60 px-4 py-3"
      }
    >
      <p className="micro-label">{label}</p>
      {children}
    </div>
  );
}
