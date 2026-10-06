"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HourglassIcon, LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { useSession } from "@/features/account/queries";
import { PLAN_PATH } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { trialNotice } from "./plan";
import { usePlan } from "./queries";

/**
 * Above the content: a quiet bar while the trial runs (louder in its last
 * three days), a card once it ended and the workspace is read-only.
 */
export function TrialNotice() {
  const t = useTranslations("trial");
  const plan = usePlan();
  const { worker } = useSession();
  const pathname = usePathname();
  const notice = trialNotice(plan);

  // The plan page says it all itself.
  if (notice.kind === "none" || pathname === PLAN_PATH) return null;

  if (notice.kind === "expired") {
    return (
      <section
        role="status"
        className="mb-6 flex flex-col gap-4 rounded-card border border-gold/50 bg-gold/10 p-5 sm:flex-row sm:items-center"
      >
        <LockIcon aria-hidden className="size-6 shrink-0 text-gold" />
        <div className="flex flex-1 flex-col gap-1">
          <h2 className="font-semibold text-ink">{t("expired.title")}</h2>
          <p className="text-sm text-ink-soft">
            {worker ? t("expired.workerText") : t("expired.text")}
          </p>
        </div>
        {!worker && (
          <Link href={PLAN_PATH} className={buttonVariants()}>
            {t("expired.cta")}
          </Link>
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
      <Link
        href={PLAN_PATH}
        className={cn(
          "ml-auto inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline mouse:min-h-0",
          notice.urgent ? "text-orange" : "text-violet",
        )}
      >
        {t("choosePlan")}
      </Link>
    </div>
  );
}
