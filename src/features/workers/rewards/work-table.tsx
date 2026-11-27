"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CheckCheckIcon, CheckIcon, PencilIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import type { Tone } from "@/components/ui/tone";
import { dayStart, shiftIsoDate } from "@/features/crm-tasks/logic";
import { Segmented } from "@/features/finance/segmented";
import { formatDate, formatPrice, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { horizonRange } from "../dashboard/chart-logic";
import { taskOutcome, type TaskOutcome } from "../dashboard/outcome";
import type { DashboardWorker } from "../dashboard/types";
import { useWorkerDeals, useWorkerTasks } from "../dashboard/work-queries";
import { EditEntryDialog } from "./entry-dialogs";
import { useReviewEntries, useRewardEntries, type ReviewAction } from "./queries";
import { entriesBySource, rowAmounts, rowStatus } from "./summary";
import type { EntryStatus, RewardEntry, SourceKind } from "./types";

const PERIODS = ["month", "quarter", "year"] as const;
type Period = (typeof PERIODS)[number];

export const STATUS_TONE: Record<EntryStatus, Tone> = {
  planned: "neutral",
  pending: "violet",
  approved: "teal",
  rejected: "pink",
  paid: "green",
};

const OUTCOME_TONE: Record<TaskOutcome, Tone> = {
  onTime: "green",
  late: "gold",
  missed: "pink",
  open: "neutral",
};

type Row = {
  key: string;
  title: string;
  /** What it is: a task, a deal, a call… */
  source: SourceKind;
  /** A task's result, a deal's state; nothing for the rest. */
  state: { label: string; tone: Tone } | null;
  at: string;
  entries: RewardEntry[];
};

const editable = (entry: RewardEntry) =>
  entry.corrects_id === null && (entry.status === "pending" || entry.status === "approved" || entry.status === "rejected");

/**
 * The person's work with its rewards: tasks and deals (done in time, late or
 * not done; won, open or lost) and everything else they earned in the
 * period, each with its reward and status. Whoever manages the rewards
 * approves, edits and rejects here.
 */
export function WorkTable({ worker, canReview }: { worker: DashboardWorker; canReview: boolean }) {
  const t = useTranslations("workers.rewardPlan.work");
  const ts = useTranslations("workers.rewardPlan");
  const settings = useFormatSettings();
  const [period, setPeriod] = useState<Period>("month");
  const today = todayIsoDate(settings);
  const range = horizonRange({ kind: period }, today, settings);
  const instants = {
    from: dayStart(range.from, settings.timeZone).toISOString(),
    until: dayStart(shiftIsoDate(range.to, 1), settings.timeZone).toISOString(),
  };
  const tasks = useWorkerTasks(worker.id, worker.userId, range);
  const deals = useWorkerDeals(worker.id, worker.userId);
  const entries = useRewardEntries(worker.id, instants);
  const review = useReviewEntries("worker");
  const [editing, setEditing] = useState<RewardEntry | null>(null);

  const rows = useMemo((): Row[] => {
    if (!entries.data) return [];
    const now = new Date();
    const bySource = entriesBySource(entries.data);
    const seen = new Set<string>();
    const list: Row[] = [];
    for (const task of tasks.data ?? []) {
      const outcome = taskOutcome(task, now, settings);
      seen.add(task.id);
      list.push({
        key: `task-${task.id}`,
        title: task.title,
        source: task.origin === "crm" ? "crm_task" : "worker_task",
        state: { label: t(`outcome.${outcome}`), tone: OUTCOME_TONE[outcome] },
        at: task.completedAt ?? task.dueAt ?? task.createdAt,
        entries: bySource.get(task.id) ?? [],
      });
    }
    for (const deal of deals.data ?? []) {
      const own = bySource.get(deal.id) ?? [];
      const wonInRange = deal.won_at !== null && deal.won_at >= instants.from && deal.won_at < instants.until;
      const open = deal.won_at === null && deal.lost_at === null;
      if (!wonInRange && !open && own.length === 0) continue;
      seen.add(deal.id);
      const state = deal.won_at ? "won" : deal.lost_at ? "lost" : "open";
      list.push({
        key: `deal-${deal.id}`,
        title: deal.title,
        source: "deal",
        state: { label: t(`deal.${state}`), tone: state === "won" ? "green" : state === "lost" ? "pink" : "neutral" },
        at: deal.won_at ?? deal.created_at,
        entries: own,
      });
    }
    // Everything else the person earned: calls, meetings, hours, the month, by hand…
    const rest = new Map<string, RewardEntry[]>();
    for (const entry of entries.data) {
      if (entry.source_id && seen.has(entry.source_id)) continue;
      const key = entry.source_id && entry.source_kind !== "manual" ? `${entry.source_kind}-${entry.source_id}` : entry.id;
      rest.set(key, [...(rest.get(key) ?? []), entry]);
    }
    for (const [key, group] of rest) {
      const first = group[0]!;
      list.push({
        key,
        title: first.note || ts(`source.${first.source_kind}`),
        source: first.rule_kind === "manual" ? "manual" : first.source_kind,
        state: null,
        at: first.occurred_at,
        entries: group,
      });
    }
    const weight = (row: Row) => {
      const status = rowStatus(row.entries);
      return status === "pending" ? 0 : status === "approved" ? 1 : status === "planned" ? 2 : 3;
    };
    return list.sort((a, b) => weight(a) - weight(b) || b.at.localeCompare(a.at));
  }, [entries.data, tasks.data, deals.data, settings, t, ts, instants.from, instants.until]);

  const pendingIds = (entries.data ?? []).filter((entry) => entry.status === "pending").map((entry) => entry.id);
  const act = (ids: string[], action: ReviewAction) => review.mutate({ ids, action });

  return (
    <GlowCard interactive={false} className="flex flex-col gap-4" data-testid="reward-work-table" data-tutorial="reward-work-table">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold text-ink">{t("title")}</h3>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {canReview && pendingIds.length > 0 && (
            <Button size="sm" onClick={() => act(pendingIds, "approve")} disabled={review.isPending} data-testid="reward-approve-all">
              <CheckCheckIcon aria-hidden data-icon="inline-start" />
              {t("approveAll", { count: pendingIds.length })}
            </Button>
          )}
          <Segmented
            label={t("period")}
            value={period}
            options={PERIODS.map((value) => ({ value, label: t(`periods.${value}`) }))}
            onChange={setPeriod}
          />
        </div>
      </div>
      {review.isError && <FormAlert>{t("reviewFailed")}</FormAlert>}
      {entries.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : !entries.data || tasks.isPending || deals.isPending ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-4 text-sm text-ink-muted">{t("empty")}</p>
      ) : (
        <ul className="-mx-2 flex flex-col divide-y divide-line/50">
          {rows.map((row) => {
            const status = rowStatus(row.entries);
            const amounts = rowAmounts(row.entries);
            const pending = row.entries.filter((entry) => entry.status === "pending" && !entry.corrects_id);
            const approved = row.entries.filter((entry) => entry.status === "approved" && !entry.corrects_id);
            const rejected = row.entries.filter((entry) => entry.status === "rejected");
            const editableEntries = row.entries.filter(editable);
            return (
              <li key={row.key} className="flex flex-col gap-2 px-2 py-3 sm:flex-row sm:items-center sm:gap-3" data-testid="reward-work-row">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-medium text-ink" title={row.title}>
                    {row.title}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                    <span>{ts(`source.${row.source}`)}</span>
                    <span aria-hidden>·</span>
                    <span>{formatDate(new Date(row.at), settings)}</span>
                    {row.state && <StatusPill tone={row.state.tone}>{row.state.label}</StatusPill>}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                  <span className="flex flex-col items-end gap-1">
                    <span className="text-sm font-semibold text-ink tabular-nums">
                      {amounts.length === 0
                        ? "—"
                        : amounts.map((item) => formatPrice(item.amount, item.currency, settings)).join(" · ")}
                    </span>
                    {status && <StatusPill tone={STATUS_TONE[status]}>{ts(`status.${status}`)}</StatusPill>}
                  </span>
                  {canReview && (
                    <span className="flex items-center">
                      {pending.length > 0 && (
                        <IconAction label={t("approve")} onClick={() => act(pending.map((e) => e.id), "approve")} disabled={review.isPending} tone="green">
                          <CheckIcon aria-hidden className="size-4" />
                        </IconAction>
                      )}
                      {(pending.length > 0 || approved.length > 0) && (
                        <IconAction
                          label={t("reject")}
                          onClick={() => act([...pending, ...approved].map((e) => e.id), "reject")}
                          disabled={review.isPending}
                          tone="pink"
                        >
                          <XIcon aria-hidden className="size-4" />
                        </IconAction>
                      )}
                      {rejected.length > 0 && (
                        <IconAction label={t("restore")} onClick={() => act(rejected.map((e) => e.id), "pending")} disabled={review.isPending}>
                          <RotateCcwIcon aria-hidden className="size-4" />
                        </IconAction>
                      )}
                      {editableEntries.length === 1 && (
                        <IconAction label={t("edit")} onClick={() => setEditing(editableEntries[0]!)}>
                          <PencilIcon aria-hidden className="size-4" />
                        </IconAction>
                      )}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <EditEntryDialog entry={editing} onOpenChange={(open) => !open && setEditing(null)} />
    </GlowCard>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "green" | "pink";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={
        "grid size-11 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 mouse:size-9 " +
        (tone === "green"
          ? "text-green hover:bg-green/10"
          : tone === "pink"
            ? "text-pink hover:bg-pink/10"
            : "text-ink-soft hover:text-ink")
      }
    >
      {children}
    </button>
  );
}
