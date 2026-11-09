"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HourglassIcon, LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { useSession } from "@/features/account/queries";
import { PayButton, paymentsInBrowser } from "@/features/subscription/pay-button";
import { useSubscription } from "@/features/subscription/queries";
import { isManagedPlan, paymentRoute } from "@/features/subscription/state";
import { track } from "@/lib/analytics/client";
import { PLAN_PATH } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { trialNotice } from "./plan";
import { usePlan } from "./queries";

/**
 * Above the content: a quiet bar while the trial runs (louder in its last
 * three days), a card once it ended and the workspace is read-only, and the
 * same card when it is read-only for holding more than its plan allows.
 */
/** The notice is recorded once per load, not on every page it appears on. */
let noticeTracked = false;

export function TrialNotice() {
  const t = useTranslations("trial");
  const plan = usePlan();
  const { worker } = useSession();
  const pathname = usePathname();
  const notice = trialNotice(plan);
  const shownKind =
    notice.kind === "none" || pathname === PLAN_PATH || (worker && notice.kind === "trial")
      ? null
      : notice.kind;
  const daysLeft = notice.kind === "trial" ? notice.daysLeft : 0;
  // "Pay and continue" for the owner in the trial's last days and once it ended.
  const offerPay =
    !worker && paymentsInBrowser() && (notice.kind === "expired" || (notice.kind === "trial" && notice.urgent));
  const own = useSubscription({ enabled: offerPay });
  const payable = own.data && isManagedPlan(own.data) && paymentRoute(own.data) === "checkout" ? own.data : null;

  // Once per load of the app: the trial's state as the owner sees it.
  useEffect(() => {
    if (!shownKind || shownKind === "overLimit" || noticeTracked) return;
    noticeTracked = true;
    track("trial_notice_shown", { days_left: daysLeft, expired: shownKind === "expired" });
  }, [shownKind, daysLeft]);

  // The plan page says it all itself.
  if (notice.kind === "none" || pathname === PLAN_PATH) return null;

  if (notice.kind === "expired" || notice.kind === "overLimit") {
    const key = notice.kind;
    return (
      <section
        role="status"
        className="mb-6 flex flex-col gap-4 rounded-card border border-gold/50 bg-gold/10 p-5 sm:flex-row sm:items-center"
      >
        <LockIcon aria-hidden className="size-6 shrink-0 text-gold" />
        <div className="flex flex-1 flex-col gap-1">
          <h2 className="font-semibold text-ink">{t(`${key}.title`)}</h2>
          <p className="text-sm text-ink-soft">
            {worker ? t(`${key}.workerText`) : t(`${key}.text`)}
          </p>
        </div>
        {!worker && (
          <div className="flex flex-wrap items-start gap-2">
            {key === "expired" && offerPay && payable && (
              <PayButton planKey={payable.planKey} billing={payable.billing} from="read_only" />
            )}
            <Link
              href={PLAN_PATH}
              className={buttonVariants({ variant: key === "expired" && payable ? "outline" : "default" })}
            >
              {t(`${key}.cta`)}
            </Link>
          </div>
        )}
      </section>
    );
  }

  // Only the owner decides about the plan; a worker's screen stays clean.
  if (worker) return null;
  return (
    <div
      className={cn(
        "mb-6 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2 text-sm",
        notice.urgent
          ? "border-orange/50 bg-orange/10 text-ink"
          : "border-line/70 bg-surface/50 text-ink-soft",
      )}
    >
      <HourglassIcon
        aria-hidden
        className={cn("size-4 shrink-0", notice.urgent ? "text-orange" : "text-ink-muted")}
      />
      <span>{t("banner", { days: notice.daysLeft })}</span>
      {offerPay && payable && (
        <div className="ml-auto">
          <PayButton planKey={payable.planKey} billing={payable.billing} from="trial_banner" size="sm" />
        </div>
      )}
      <Link
        href={PLAN_PATH}
        className={cn(
          "inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline mouse:min-h-0",
          !(offerPay && payable) && "ml-auto",
          notice.urgent ? "text-orange" : "text-violet",
        )}
      >
        {t("choosePlan")}
      </Link>
    </div>
  );
}
