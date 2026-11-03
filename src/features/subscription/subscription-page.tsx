"use client";

import { useState, type ReactNode } from "react";
import { CalendarClockIcon, InfoIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import type { Tone } from "@/components/ui/tone";
import { isPaidPlanKey, priceCurrencyFor, type PlanCatalog } from "@/config/pricing";
import { useSession, useUserSettings } from "@/features/account/queries";
import { AppOverview } from "@/features/plan/app-overview";
import { planName } from "@/features/plan/catalog";
import { SettingsPage } from "@/features/settings/ui";
import { formatDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { BillingDetailsForm } from "./billing-details-form";
import { CancelDialog } from "./cancel-dialog";
import { ChangePlanDialog } from "./change-plan-dialog";
import { PaymentHistory } from "./payment-history";
import { money, PlanPrice, priceOf } from "./plan-price";
import { SubscriptionActionError, useRequestChange, useResumeSubscription, useSubscription } from "./queries";
import {
  canCancel,
  canResume,
  changeBlock,
  displayStatus,
  isExpired,
  isManagedPlan,
  nextPayment,
  periodEndOf,
  type DisplayStatus,
} from "./state";

const STATUS_TONE: Record<DisplayStatus, Tone> = {
  beta: "violet",
  trialing: "teal",
  active: "green",
  pastDue: "pink",
  ending: "gold",
  expired: "pink",
};

/** A message after an action, shown on the card until the next one. */
export type SubscriptionNotice = { tone: "success" | "error"; text: string } | null;

/**
 * Settings → Subscription: the plan in force, choosing another one,
 * cancelling and taking it back, the payments and the billing details. Only
 * the owner of a workspace has one; a worker sees who handles it. Until a
 * payment gateway exists, choices are recorded and shown, nothing is charged.
 */
export function SubscriptionPage({ plans }: { plans: PlanCatalog }) {
  const t = useTranslations("subscription");
  const { worker, roles } = useSession();
  return (
    <SettingsPage title={t("title")} description={t("description")}>
      {worker ? (
        <EmptyState title={t("workerTitle")} description={t("workerText")} />
      ) : (
        <>
          <div id="settings-plan" tabIndex={-1} data-setting-row className="rounded-card outline-none">
            <CurrentPlan plans={plans} />
          </div>
          <div id="settings-payments" tabIndex={-1} data-setting-row className="rounded-card outline-none">
            <PaymentHistory />
          </div>
          <div id="settings-billing" tabIndex={-1} data-setting-row className="rounded-card outline-none">
            <BillingDetailsForm />
          </div>
          {/* The app's own owner also sees how the accounts of the app are doing. */}
          {roles.includes("owner") && <AppOverview />}
        </>
      )}
    </SettingsPage>
  );
}

function CurrentPlan({ plans }: { plans: PlanCatalog }) {
  const t = useTranslations("subscription");
  const tPlans = useTranslations("plans");
  const locale = useLocale();
  const settings = useUserSettings();
  const format = useFormatSettings();
  const query = useSubscription();
  const resume = useResumeSubscription();
  const unschedule = useRequestChange();
  const [changing, setChanging] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<SubscriptionNotice>(null);

  if (query.isPending) return <Skeleton className="h-72 w-full rounded-card" />;
  if (query.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;
  const sub = query.data;
  if (!sub) return <FormAlert>{t("loadFailed")}</FormAlert>;

  const now = new Date();
  const status = displayStatus(sub, now);
  const currency = priceCurrencyFor(settings.currency);
  const nameOf = (key: string) => planName(plans, key, locale) ?? tPlans("names.beta");
  const plan = isPaidPlanKey(sub.planKey) ? plans.find((p) => p.key === sub.planKey) : undefined;
  const date = (at: string | null) => (at ? formatDate(new Date(at), format) : "");
  const failed = (error: unknown) =>
    setNotice({
      tone: "error",
      text: t(`errors.${error instanceof SubscriptionActionError ? error.code : "unknown"}`),
    });

  const statusText = (() => {
    switch (status) {
      case "trialing":
        return t("status.trialing", { date: date(sub.trialEndsAt) });
      case "ending":
        return t("status.ending", { date: date(periodEndOf(sub)) });
      case "expired": {
        const end = periodEndOf(sub) ?? sub.trialEndsAt;
        return end ? t("status.expired", { date: date(end) }) : t("status.expiredNoDate");
      }
      default:
        return t(`status.${status}`);
    }
  })();

  const next = nextPayment(sub, now);
  const nextPlan = next && plans.find((p) => p.key === next.planKey);
  const block = changeBlock(sub, now);

  function doResume() {
    setNotice(null);
    resume.mutate(undefined, {
      onSuccess: () => setNotice({ tone: "success", text: t("notices.resumed") }),
      onError: failed,
    });
  }

  function dropScheduled() {
    if (!isManagedPlan(sub!)) return;
    setNotice(null);
    unschedule.mutate(
      { planKey: sub!.planKey, billing: sub!.billing },
      {
        onSuccess: () => setNotice({ tone: "success", text: t("notices.unscheduled") }),
        onError: failed,
      },
    );
  }

  return (
    <GlowCard interactive={false} className="flex flex-col gap-6 md:p-6" data-testid="subscription-current">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="micro-label">{t("current.title")}</p>
          <h2 className="text-2xl font-semibold text-ink">{nameOf(sub.planKey)}</h2>
        </div>
        <StatusPill tone={STATUS_TONE[status]} dot data-testid="subscription-status">
          {statusText}
        </StatusPill>
      </header>

      {status === "beta" ? (
        <p className="max-w-2xl text-sm text-ink-soft">{t("current.betaText")}</p>
      ) : (
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label={t("current.price")}>
            {plan ? <PlanPrice plan={plan} billing={sub.billing} currency={currency} format={format} /> : "–"}
          </Fact>
          <Fact label={t("current.period")}>{tPlans(`billing.${sub.billing}`)}</Fact>
          <Fact label={t("current.nextPayment")}>
            {next && nextPlan
              ? t("current.nextPaymentValue", {
                  amount: money(priceOf(nextPlan, next.billing, currency), currency, format),
                  date: date(next.at),
                })
              : t("current.noNextPayment")}
          </Fact>
        </dl>
      )}

      {sub.scheduled && !isExpired(sub, now) && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-ink"
          data-testid="subscription-scheduled"
        >
          <CalendarClockIcon aria-hidden className="size-4 shrink-0 text-gold" />
          <span className="min-w-0 flex-1">
            {t("current.scheduled", {
              date: date(sub.scheduled.at),
              plan: nameOf(sub.scheduled.planKey),
              billing: tPlans(`billing.${sub.scheduled.billing}`),
            })}
          </span>
          {!block && (
            <Button variant="ghost" size="sm" onClick={dropScheduled} disabled={unschedule.isPending}>
              {t("current.cancelScheduled")}
            </Button>
          )}
        </div>
      )}

      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}

      {status !== "beta" && (
        <div className="flex flex-col gap-4 border-t border-line/60 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            {!block && (
              <Button onClick={() => setChanging(true)}>{t("actions.change")}</Button>
            )}
            {canResume(sub, now) && (
              <Button onClick={doResume} disabled={resume.isPending}>
                {t("actions.resume")}
              </Button>
            )}
            {canCancel(sub, now) && (
              <Button variant="ghost" className="text-ink-soft sm:ml-auto" onClick={() => setCancelling(true)}>
                {t("actions.cancel")}
              </Button>
            )}
          </div>
          <p className="flex items-start gap-2 text-xs text-ink-muted">
            <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t("noGateway")}
          </p>
        </div>
      )}

      {isManagedPlan(sub) && (
        <>
          <ChangePlanDialog
            open={changing}
            onOpenChange={setChanging}
            subscription={sub}
            plans={plans}
            onDone={(text) => setNotice({ tone: "success", text })}
          />
          <CancelDialog
            open={cancelling}
            onOpenChange={setCancelling}
            endsAt={date(periodEndOf(sub))}
            onDone={(text) => setNotice({ tone: "success", text })}
          />
        </>
      )}
    </GlowCard>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-[15px] font-medium text-ink">{children}</dd>
    </div>
  );
}
