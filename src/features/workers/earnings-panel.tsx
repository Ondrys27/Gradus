"use client";

import { useState } from "react";
import {
  CheckCheckIcon,
  CheckIcon,
  ClockIcon,
  CoinsIcon,
  HandshakeIcon,
  ListChecksIcon,
  TrophyIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Pager } from "@/features/finance/pager";
import { Segmented } from "@/features/finance/segmented";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { EARNING_TONE, PAGE_SIZE } from "./logic";
import { useApproveEarnings, useEarnings } from "./queries";
import { EARNING_STATUSES, type Earning, type EarningStatus, type RewardTrigger } from "./types";

const SOURCE_ICON: Record<RewardTrigger, LucideIcon> = {
  task_completed: ListChecksIcon,
  meeting_booked: HandshakeIcon,
  deal_won: TrophyIcon,
  hour_worked: ClockIcon,
};

type Filter = EarningStatus | "all";

type Props = {
  workerId: string;
  /** The owner approves with one tap; the worker only reads. */
  canApprove: boolean;
};

/** Earnings newest first, filtered by status, twenty a page. */
export function EarningsPanel({ workerId, canApprove }: Props) {
  const t = useTranslations("workers.earnings");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const query = useEarnings(workerId, filter === "all" ? null : filter, page);
  const pending = useEarnings(canApprove ? workerId : null, "pending", 0);
  const approve = useApproveEarnings(workerId);
  const pendingTotal = pending.data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label={t("filter")}
          value={filter}
          options={[
            { value: "all", label: t("all") },
            ...EARNING_STATUSES.map((status) => ({ value: status, label: t(`status.${status}`) })),
          ]}
          onChange={(value) => {
            setFilter(value);
            setPage(0);
          }}
        />
        {canApprove && pendingTotal > 0 && (
          <Button onClick={() => approve.mutate("all")} disabled={approve.isPending}>
            <CheckCheckIcon aria-hidden data-icon="inline-start" />
            {t("approveAll", { count: pendingTotal })}
          </Button>
        )}
      </div>
      {approve.isError && <FormAlert>{t("approveFailed")}</FormAlert>}

      {query.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : !query.data ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-16 w-full" />
          ))}
        </div>
      ) : query.data.rows.length === 0 ? (
        <EmptyState
          icon={<CoinsIcon />}
          title={t("emptyTitle")}
          description={t(canApprove ? "emptyOwner" : "emptyWorker")}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {query.data.rows.map((earning) => (
              <EarningRow
                key={earning.id}
                earning={earning}
                onApprove={
                  canApprove && earning.status === "pending"
                    ? () => approve.mutate([earning.id])
                    : undefined
                }
                approving={approve.isPending}
              />
            ))}
          </ul>
          <Pager
            page={page}
            pages={Math.max(1, Math.ceil(query.data.total / PAGE_SIZE))}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

function EarningRow({
  earning,
  onApprove,
  approving,
}: {
  earning: Earning;
  onApprove?: () => void;
  approving: boolean;
}) {
  const t = useTranslations("workers.earnings");
  const settings = useFormatSettings();
  const Icon = earning.source ? SOURCE_ICON[earning.source] : CoinsIcon;
  const detail =
    earning.source === "hour_worked" && earning.basis !== null
      ? t("hoursDetail", { hours: formatNumber(earning.basis, { decimals: 2 }, settings) })
      : earning.source === "deal_won" && earning.basis !== null
        ? t("dealDetail", {
            name: earning.description ?? "",
            value: formatCurrency(earning.basis, undefined, settings),
          })
        : earning.description;

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-surface/70 px-4 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-gold/30 bg-gold/10 text-gold">
        <Icon aria-hidden className="size-4.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">
          {t(`source.${earning.source ?? "manual"}`)}
        </span>
        {detail && (
          <span className="truncate text-xs text-ink-soft" title={detail}>
            {detail}
          </span>
        )}
        <span className="text-xs text-ink-muted">
          {formatDate(new Date(earning.created_at), settings)}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="font-semibold text-gold tabular-nums">
          {formatCurrency(earning.amount, undefined, settings, earning.amount % 1 === 0 ? 0 : 2)}
        </span>
        {onApprove ? (
          <Button size="sm" variant="outline" onClick={onApprove} disabled={approving}>
            <CheckIcon aria-hidden data-icon="inline-start" />
            {t("approve")}
          </Button>
        ) : (
          <StatusPill tone={EARNING_TONE[earning.status]}>
            {t(`status.${earning.status}`)}
          </StatusPill>
        )}
      </div>
    </li>
  );
}
