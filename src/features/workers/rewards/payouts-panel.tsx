"use client";

import { useMemo, useState } from "react";
import { BanknoteIcon, DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { Pager } from "@/features/finance/pager";
import { track } from "@/lib/analytics/client";
import { downloadBlob } from "@/lib/download";
import { formatCalendarDate, formatDate, formatPrice, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { PayoutDialog, type PayoutRequest } from "./entry-dialogs";
import { loadAllPayouts, PAYOUTS_PAGE, useRewardEntries, useRewardPayouts } from "./queries";
import { payoutCheck, payoutsCsv } from "./summary";
import type { RewardPayout } from "./types";

/** The CSV file of payouts, for one person or everyone the viewer may see. */
export function useExportPayouts() {
  const t = useTranslations("workers.rewardPlan.payouts.csv");
  const settings = useFormatSettings();
  const space = useWorkspaceId();
  return async (workerId: string | null, nameOf: (id: string) => string) => {
    const payouts = await loadAllPayouts(space, workerId);
    const csv = payoutsCsv(payouts, nameOf, settings, {
      paidOn: t("paidOn"),
      worker: t("worker"),
      from: t("from"),
      to: t("to"),
      entries: t("entries"),
      amount: t("amount"),
      currency: t("currency"),
      note: t("note"),
    });
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${t("file")}-${todayIsoDate(settings)}.csv`);
    track("reward_payouts_exported", { rows: payouts.length });
  };
}

/**
 * Paying one person: choose approved rewards (all of one currency at once),
 * "Mark paid" with a day and a note; below the history of payouts and the
 * CSV file. The person sees only the history.
 */
export function PayoutsPanel({
  workerId,
  name,
  canPay,
}: {
  workerId: string;
  name: string;
  /** Manages this person's rewards and the space is not read-only. */
  canPay: boolean;
}) {
  const t = useTranslations("workers.rewardPlan.payouts");
  const settings = useFormatSettings();
  const range = useMemo(() => ({ from: new Date(0).toISOString(), until: new Date(0).toISOString() }), []);
  // Only the open ones (approved among them): the range is empty on purpose.
  const entries = useRewardEntries(workerId, range);
  const approved = (entries.data ?? []).filter((entry) => entry.status === "approved");
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const selected = chosen ?? new Set(approved.filter((e) => e.currency === approved[0]?.currency).map((e) => e.id));
  const pick = approved.filter((entry) => selected.has(entry.id));
  const check = payoutCheck(pick);
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const exportCsv = useExportPayouts();
  const [exportFailed, setExportFailed] = useState(false);

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setChosen(next);
  }

  return (
    <GlowCard interactive={false} className="flex flex-col gap-4" data-testid="reward-payouts">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold text-ink">{t("title")}</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setExportFailed(false);
            exportCsv(workerId, () => name).catch(() => setExportFailed(true));
          }}
        >
          <DownloadIcon aria-hidden data-icon="inline-start" />
          {t("export")}
        </Button>
      </div>
      {exportFailed && <FormAlert>{t("exportFailed")}</FormAlert>}

      {canPay &&
        (entries.isError ? (
          <FormAlert>{t("loadFailed")}</FormAlert>
        ) : !entries.data ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : approved.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("nothingApproved")}</p>
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-line p-3">
            <span className="micro-label">{t("toPay")}</span>
            <ul className="flex max-h-72 flex-col overflow-y-auto">
              {approved.map((entry) => (
                <li key={entry.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-surface-hover">
                    <Checkbox
                      checked={selected.has(entry.id)}
                      onCheckedChange={(on) => toggle(entry.id, on === true)}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {entry.note || t("noNote")}
                    </span>
                    <span className="text-xs text-ink-muted">{formatDate(new Date(entry.occurred_at), settings)}</span>
                    <span className="text-sm font-semibold text-ink tabular-nums">
                      {formatPrice(entry.amount, entry.currency, settings)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-ink-soft">
                {check.ok
                  ? t("total", { amount: formatPrice(check.total, check.currency, settings) })
                  : t(`problem.${check.reason}`)}
              </span>
              <Button
                disabled={!check.ok}
                data-testid="reward-mark-paid"
                onClick={() =>
                  check.ok &&
                  setRequests([
                    { workerId, name, ids: pick.map((entry) => entry.id), total: check.total, currency: check.currency },
                  ])
                }
              >
                <BanknoteIcon aria-hidden data-icon="inline-start" />
                {t("markPaid")}
              </Button>
            </div>
          </div>
        ))}

      <PayoutHistory workerId={workerId} />
      <PayoutDialog
        requests={requests}
        from="worker"
        onOpenChange={(open) => {
          if (!open) {
            setRequests([]);
            setChosen(null);
          }
        }}
      />
    </GlowCard>
  );
}

/** Payouts newest first, twenty a page. */
export function PayoutHistory({
  workerId,
  nameOf,
}: {
  workerId: string | null;
  nameOf?: (id: string) => string;
}) {
  const t = useTranslations("workers.rewardPlan.payouts");
  const [page, setPage] = useState(0);
  const query = useRewardPayouts(workerId, page);
  if (query.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (!query.data) return <Skeleton className="h-16 w-full rounded-xl" />;
  if (query.data.rows.length === 0) return <p className="text-sm text-ink-muted">{t("empty")}</p>;
  return (
    <div className="flex flex-col gap-3">
      <span className="micro-label">{t("history")}</span>
      <ul className="flex flex-col gap-2" data-testid="reward-payout-history">
        {query.data.rows.map((payout) => (
          <PayoutRow key={payout.id} payout={payout} name={nameOf?.(payout.worker_id)} />
        ))}
      </ul>
      <Pager page={page} pages={Math.max(1, Math.ceil(query.data.total / PAYOUTS_PAGE))} onPage={setPage} />
    </div>
  );
}

function PayoutRow({ payout, name }: { payout: RewardPayout; name?: string }) {
  const t = useTranslations("workers.rewardPlan.payouts");
  const settings = useFormatSettings();
  const period =
    payout.period_from && payout.period_to
      ? t("period", {
          from: formatCalendarDate(payout.period_from, settings),
          to: formatCalendarDate(payout.period_to, settings),
        })
      : null;
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-surface/70 px-4 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-green/30 bg-green/10 text-green">
        <BanknoteIcon aria-hidden className="size-4.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">
          {name ? `${name} · ` : ""}
          {formatDate(new Date(payout.paid_at), settings)}
        </span>
        <span className="truncate text-xs text-ink-soft">
          {[period, payout.entries > 0 ? t("entries", { count: payout.entries }) : null, payout.note]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <span className="font-semibold text-green tabular-nums">
        {formatPrice(payout.total, payout.currency, settings)}
      </span>
    </li>
  );
}
