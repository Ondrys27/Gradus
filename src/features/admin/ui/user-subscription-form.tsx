"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { SimpleSelect } from "@/features/invoices/simple-select";
import { BILLINGS, STORED_STATUSES } from "@/features/subscription/state";
import { formatCalendarDate } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { saveUserSubscription, type SubscriptionActionResult } from "../server/subscription-actions";
import {
  ADMIN_PLAN_KEYS,
  adminSubscriptionSchema,
  sameSubscription,
  type AdminSubscriptionForm,
} from "../subscription-form";

/**
 * One account's subscription set by hand: plan, billing, status, end of the
 * period and the cancellation. Saving asks for confirmation from → to. A
 * subscription that runs in Stripe says, above the form and in the
 * confirmation, that a change by hand does not reach Stripe.
 */
export function UserSubscriptionForm({
  userId,
  saved,
  planLabels,
  stripe = false,
}: {
  userId: string;
  saved: AdminSubscriptionForm;
  planLabels: Record<string, string>;
  /** The subscription runs in Stripe (provider = stripe). */
  stripe?: boolean;
}) {
  const t = useTranslations("admin.users.subscription");
  const tPlans = useTranslations("plans.billing");
  const router = useRouter();
  const [values, setValues] = useState<AdminSubscriptionForm>(saved);
  const [notice, setNotice] = useState<"saved" | "noChanges" | null>(null);
  const [problem, setProblem] = useState<Exclude<SubscriptionActionResult, { ok: true }>["error"] | null>(
    null,
  );
  const [endError, setEndError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<AdminSubscriptionForm>) => {
    setValues((current) => ({ ...current, ...patch }));
    setNotice(null);
    setEndError(false);
  };
  const summary = (value: AdminSubscriptionForm) =>
    t("form.summary", {
      plan: planLabels[value.planKey] ?? value.planKey,
      billing: tPlans(value.billing),
      status: t(`statuses.${value.status}`),
      end: value.periodEnd
        ? t("form.summaryEnd", { date: formatCalendarDate(value.periodEnd, ADMIN_FORMAT_SETTINGS) })
        : "",
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    if (!adminSubscriptionSchema.safeParse(values).success) {
      setEndError(true);
      return;
    }
    if (sameSubscription(values, saved)) {
      setNotice("noChanges");
      return;
    }
    setConfirming(true);
  }

  function confirm() {
    startTransition(async () => {
      const result = await saveUserSubscription(userId, values).catch(
        (): SubscriptionActionResult => ({ ok: false, error: "failed" }),
      );
      if (!result.ok) {
        setProblem(result.error);
        return;
      }
      setConfirming(false);
      setNotice("saved");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="user-subscription-form">
      {stripe && <StripeWarning testId="user-subscription-stripe-warning">{t("stripeWarning")}</StripeWarning>}
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="subscription-plan" label={t("form.planLabel")}>
          <SimpleSelect
            id="subscription-plan"
            value={values.planKey}
            options={ADMIN_PLAN_KEYS.map((key) => ({ value: key, label: planLabels[key] ?? key }))}
            onChange={(value) => set({ planKey: value as AdminSubscriptionForm["planKey"] })}
          />
        </FormField>
        <FormField id="subscription-billing" label={t("form.billingLabel")}>
          <SimpleSelect
            id="subscription-billing"
            value={values.billing}
            options={BILLINGS.map((key) => ({ value: key, label: tPlans(key) }))}
            onChange={(value) => set({ billing: value as AdminSubscriptionForm["billing"] })}
          />
        </FormField>
        <FormField id="subscription-status" label={t("form.statusLabel")}>
          <SimpleSelect
            id="subscription-status"
            value={values.status}
            options={STORED_STATUSES.map((key) => ({ value: key, label: t(`statuses.${key}`) }))}
            onChange={(value) => set({ status: value as AdminSubscriptionForm["status"] })}
          />
        </FormField>
      </div>
      <FormField
        id="subscription-end"
        label={t("form.periodEndLabel")}
        hint={t("form.periodEndHint")}
        error={endError ? t("form.errors.invalid") : undefined}
        className="max-w-xs"
      >
        <Input
          {...fieldA11y("subscription-end", endError, true)}
          type="date"
          value={values.periodEnd}
          className="h-11 mouse:h-9"
          onChange={(event) => set({ periodEnd: event.target.value })}
        />
      </FormField>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
        <Checkbox
          checked={values.cancelAtPeriodEnd}
          onCheckedChange={(checked) => set({ cancelAtPeriodEnd: checked === true })}
        />
        {t("form.cancelLabel")}
      </label>

      {notice && (
        <p role="status" className="text-sm text-ink-soft">
          {t(`form.${notice}`)}
        </p>
      )}
      {problem && !confirming && <FormAlert>{t(`form.errors.${problem}`)}</FormAlert>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {t("form.save")}
        </Button>
      </div>

      <ResponsiveDialog
        open={confirming}
        onOpenChange={(open) => !pending && setConfirming(open)}
        title={t("form.confirmTitle")}
        closeLabel={t("form.close")}
      >
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-soft" data-testid="user-subscription-change">
            {t("form.confirmDescription", { from: summary(saved), to: summary(values) })}
          </p>
          {stripe && <StripeWarning>{t("form.confirmStripe")}</StripeWarning>}
          {problem && <FormAlert>{t(`form.errors.${problem}`)}</FormAlert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {t("form.cancel")}
            </Button>
            <Button type="button" disabled={pending} onClick={confirm}>
              {t("form.confirm")}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </form>
  );
}

function StripeWarning({ children, testId }: { children: string; testId?: string }) {
  return (
    <p
      role="note"
      data-testid={testId}
      className="flex items-start gap-2.5 rounded-xl border border-gold/40 bg-gold/10 px-3.5 py-3 text-sm text-ink"
    >
      <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-gold" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
