"use client";

import { useState, useTransition } from "react";
import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/ui/page-header";
import { priceCurrencyFor, type PaidPlan, type PaidPlanKey } from "@/config/pricing";
import { useSession, useUserSettings } from "@/features/account/queries";
import { PricingCards } from "@/features/marketing/pricing-cards";
import { formatDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { requestPlan } from "./actions";
import type { PlanSnapshot } from "./plan";
import { usePlan } from "./queries";

const NAMED_PLANS = ["solo", "pro", "team", "beta"] as const;

/**
 * The plan page: where the account stands and the three plans. Until payments
 * exist, "I'm interested" tells the app owner and thanks the user.
 */
export function PlanPage() {
  const t = useTranslations("plans");
  const plan = usePlan();
  const { worker } = useSession();
  const settings = useUserSettings();
  const formatSettings = useFormatSettings();
  const [sent, setSent] = useState<Partial<Record<PaidPlanKey, boolean>>>({});
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const interest = (key: PaidPlanKey) =>
    startTransition(async () => {
      setFailed(false);
      const result = await requestPlan(key).catch(() => ({ ok: false }));
      if (result.ok) setSent((current) => ({ ...current, [key]: true }));
      else setFailed(true);
    });

  const action = (paid: PaidPlan) => {
    // The owner chooses the plan of the workspace, not a worker.
    if (worker) return null;
    if (sent[paid.key]) {
      return (
        <p role="status" className="flex min-h-11 items-center gap-2 text-sm text-teal">
          <CheckIcon aria-hidden className="size-4" />
          {t("page.interestSent")}
        </p>
      );
    }
    return (
      <Button
        variant={paid.recommended ? "default" : "outline"}
        className="w-full"
        disabled={pending}
        onClick={() => interest(paid.key)}
      >
        {t("page.interest")}
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
      />
      <p className="rounded-xl border border-line/70 bg-surface/50 px-4 py-3 text-sm text-ink-soft">
        <span className="text-ink-muted">{t("page.current")}: </span>
        <span className="font-medium text-ink">{statusText(plan, t, formatSettings)}</span>
      </p>
      {failed && <FormAlert>{t("page.interestError")}</FormAlert>}
      <PricingCards
        currency={priceCurrencyFor(settings.currency)}
        formatSettings={formatSettings}
        action={action}
      />
    </div>
  );
}

function statusText(
  plan: PlanSnapshot,
  t: ReturnType<typeof useTranslations<"plans">>,
  formatSettings: ReturnType<typeof useFormatSettings>,
): string {
  const date = plan.trialEndsAt ? formatDate(new Date(plan.trialEndsAt), formatSettings) : "";
  const name = (NAMED_PLANS as readonly string[]).includes(plan.planKey)
    ? t(`names.${plan.planKey as (typeof NAMED_PLANS)[number]}`)
    : plan.planKey;
  if (plan.status === "expired" || plan.readOnly) return t("page.status.expired", { date });
  if (plan.status === "trialing") return t("page.status.trialing", { plan: name, date });
  if (plan.planKey === "beta") return t("page.status.beta");
  return t("page.status.active", { plan: name });
}
