"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { StatusPill } from "@/components/ui/status-pill";
import type { Tone } from "@/components/ui/tone";
import { stripeDashboardUrl } from "@/features/billing/stripe/dashboard";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import type { AdminStripeLink } from "../server/subscription-data";
import { syncUserSubscriptionWithStripe, type StripeSyncResult } from "../server/subscription-actions";

const TONE: Record<"paid" | "failed" | "refunded", Tone> = { paid: "green", failed: "pink", refunded: "neutral" };

/**
 * The Stripe side of an account in the administration (step 23.2): links to
 * the customer and the subscription in Stripe's dashboard (test or live by
 * the row's mode), the latest payments with their receipts and, for the
 * owner, "Sync with Stripe" (audited before it runs).
 */
export function UserStripePanel({
  userId,
  link,
  canSync,
  planLabel,
}: {
  userId: string;
  link: AdminStripeLink;
  canSync: boolean;
  /** Plan names by key. */
  planLabel: Record<string, string>;
}) {
  const t = useTranslations("admin.users.subscription");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<StripeSyncResult | null>(null);
  const mode = link.mode;
  const customer = link.customers.find((c) => c.mode === mode) ?? link.customers[0] ?? null;
  const customerUrl = customer ? stripeDashboardUrl(customer.mode, "customer", customer.id) : null;
  const subscriptionUrl = mode ? stripeDashboardUrl(mode, "subscription", link.subscriptionRef) : null;
  const nothing = !customer && !link.subscriptionRef && link.payments.length === 0;

  function sync() {
    setResult(null);
    startTransition(async () => {
      const outcome = await syncUserSubscriptionWithStripe(userId).catch(
        (): StripeSyncResult => ({ ok: false, error: "failed" }),
      );
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4 border-t border-line/60 pt-4" data-testid="admin-stripe">
      <h3 className="text-sm font-semibold text-ink">{t("stripeTitle")}</h3>
      {nothing ? (
        <p className="text-sm text-ink-muted">{t("noStripe")}</p>
      ) : (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LinkField label={t("stripeCustomer")} value={customer?.id ?? null} href={customerUrl} t={t} />
          <LinkField label={t("stripeSubscription")} value={link.subscriptionRef} href={subscriptionUrl} t={t} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-ink-muted">{t("stripeMode")}</dt>
            <dd className="text-sm text-ink">{mode ? t(`modes.${mode}`) : t("none")}</dd>
          </div>
        </dl>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs text-ink-muted">{t("payments")}</p>
        {link.payments.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("noPayments")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/60 text-sm" data-testid="admin-stripe-payments">
            {link.payments.map((payment) => {
              const invoiceUrl = payment.invoiceUrl ?? stripeDashboardUrl(payment.mode, "invoice", payment.invoiceRef);
              return (
                <li key={payment.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <span className="min-w-32 text-ink-soft tabular-nums">
                    {formatDateTime(new Date(payment.paidAt), ADMIN_FORMAT_SETTINGS)}
                  </span>
                  <span className="min-w-16 text-ink-soft">
                    {payment.planKey ? (planLabel[payment.planKey] ?? payment.planKey) : t("none")}
                  </span>
                  <span className="min-w-24 font-medium text-ink tabular-nums">
                    {formatNumber(payment.amount, { style: "currency", currency: payment.currency }, ADMIN_FORMAT_SETTINGS)}
                  </span>
                  <StatusPill tone={TONE[payment.status]}>{t(`paymentStatuses.${payment.status}`)}</StatusPill>
                  {invoiceUrl && (
                    <a
                      href={invoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex min-h-11 items-center gap-1 text-violet underline-offset-4 hover:underline mouse:min-h-0"
                    >
                      {t("receipt")}
                      <ExternalLinkIcon aria-hidden className="size-3.5" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canSync && link.subscriptionRef && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={sync} disabled={pending} data-testid="admin-stripe-sync">
              <RefreshCwIcon aria-hidden className={cn(pending && "animate-spin motion-reduce:animate-none")} />
              {t("sync")}
            </Button>
            <p className="text-xs text-ink-muted">{t("syncHint")}</p>
          </div>
          {result && (
            <FormAlert tone={result.ok ? "success" : "error"}>
              {t(`syncResult.${result.ok ? (result.fixed ? "fixed" : "same") : result.error}`)}
            </FormAlert>
          )}
        </div>
      )}
    </section>
  );
}

function LinkField({
  label,
  value,
  href,
  t,
}: {
  label: string;
  value: string | null;
  href: string | null;
  t: ReturnType<typeof useTranslations<"admin.users.subscription">>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">
        {value ? (
          href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "link" }), "h-auto min-h-11 gap-1 p-0 mouse:min-h-0")}
              title={t("openInStripe")}
            >
              <span className="truncate font-mono text-xs">{value}</span>
              <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0" />
            </a>
          ) : (
            <span className="truncate font-mono text-xs">{value}</span>
          )
        ) : (
          t("none")
        )}
      </dd>
    </div>
  );
}
