"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCardIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { useSession } from "@/features/account/queries";
import { usePlan } from "@/features/plan/queries";
import { PLAN_PATH } from "@/lib/routes";
import { paymentsInBrowser } from "./pay-button";
import { PortalButton } from "./portal-button";
import { useSubscription } from "./queries";
import { canOpenPortal, showPastDueBanner } from "./state";

/**
 * Above the content while Stripe retries a failed payment (past due): "The
 * payment did not go through, update your card" with the way to Stripe's
 * portal. The owner in their own workspace only; a worker sees nothing.
 * The subscription row is read only once the plan says past due. Settings →
 * Subscription says it on its own card.
 */
export function PastDueNotice() {
  const t = useTranslations("subscription.pastDue");
  const { worker } = useSession();
  const plan = usePlan();
  const pathname = usePathname();
  const enabled = !worker && plan.status === "past_due";
  const own = useSubscription({ enabled });
  const sub = enabled ? (own.data ?? null) : null;
  if (pathname === PLAN_PATH || !showPastDueBanner(sub, { worker: Boolean(worker) })) return null;
  const portal = paymentsInBrowser() && sub !== null && canOpenPortal(sub);

  return (
    <section
      role="status"
      data-testid="past-due-banner"
      className="mb-6 flex flex-col gap-3 rounded-card border border-pink/50 bg-pink/10 p-4 sm:flex-row sm:items-center"
    >
      <CreditCardIcon aria-hidden className="size-5 shrink-0 text-pink" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="font-semibold text-ink">{t("banner")}</h2>
        <p className="text-sm text-ink-soft">{t("bannerText")}</p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {portal && <PortalButton from="past_due_banner" variant="default" label={t("bannerCta")} />}
        <Link href={PLAN_PATH} className={buttonVariants({ variant: portal ? "ghost" : "default" })}>
          {t("bannerDetails")}
        </Link>
      </div>
    </section>
  );
}
