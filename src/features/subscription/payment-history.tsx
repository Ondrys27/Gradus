"use client";

import { DownloadIcon, ReceiptIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import type { Tone } from "@/components/ui/tone";
import { formatDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { money } from "./plan-price";
import { usePayments, type Payment } from "./queries";

const STATUS_TONE: Record<Payment["status"], Tone> = {
  paid: "green",
  failed: "pink",
  refunded: "neutral",
};

/**
 * The payments of the subscription, newest first, each with Stripe's hosted
 * receipt when it has one. A payment without one (before Stripe) keeps the
 * muted button that says so.
 */
export function PaymentHistory() {
  const t = useTranslations("subscription.payments");
  const format = useFormatSettings();
  const payments = usePayments();

  return (
    <GlowCard interactive={false} className="flex flex-col gap-5 md:p-6" data-testid="subscription-payments">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-ink-soft">{t("description")}</p>
      </header>

      {payments.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : payments.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : payments.data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-8 text-center">
          <ReceiptIcon aria-hidden className="size-6 text-ink-muted" />
          <p className="font-medium text-ink">{t("empty")}</p>
          <p className="max-w-sm text-sm text-ink-muted">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col divide-y divide-line/60" aria-label={t("title")}>
            <li
              aria-hidden
              className="hidden grid-cols-[1fr_1fr_1fr_auto] gap-4 pb-2 text-xs text-ink-muted sm:grid"
            >
              <span>{t("date")}</span>
              <span>{t("amount")}</span>
              <span>{t("status")}</span>
              <span className="w-11 text-right">{t("receipt")}</span>
            </li>
            {payments.data.map((payment) => (
              <li
                key={payment.id}
                className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-[1fr_1fr_1fr_auto]"
              >
                <span className="text-ink">{formatDate(new Date(payment.paidAt), format)}</span>
                <span className="font-medium text-ink tabular-nums sm:order-none">
                  {money(payment.amount, payment.currency, format)}
                </span>
                <span>
                  <StatusPill tone={STATUS_TONE[payment.status]}>{t(`statuses.${payment.status}`)}</StatusPill>
                </span>
                {payment.invoiceUrl ? (
                  <a
                    href={payment.invoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t("open")}
                    aria-label={t("open")}
                    data-testid="subscription-receipt"
                    className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "justify-self-end")}
                  >
                    <DownloadIcon aria-hidden />
                  </a>
                ) : (
                  // No receipt for this one; focusable so the reason can be read.
                  <button
                    type="button"
                    aria-disabled
                    title={t("receiptsSoon")}
                    aria-label={`${t("download")}: ${t("receiptsSoon")}`}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "icon" }),
                      "cursor-not-allowed justify-self-end opacity-50",
                    )}
                    onClick={(event) => event.preventDefault()}
                  >
                    <DownloadIcon aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {payments.data.some((payment) => !payment.invoiceUrl) && (
            <p className="text-xs text-ink-muted">{t("receiptsSoon")}</p>
          )}
        </div>
      )}
    </GlowCard>
  );
}
