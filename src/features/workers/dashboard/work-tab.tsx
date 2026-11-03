"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { useCan } from "@/features/account/workspace-queries";
import { sortTasks } from "@/features/crm-tasks/logic";
import { TASKS_PATH } from "@/features/crm-tasks/types";
import { useStages } from "@/features/pipeline/queries";
import { stageTone } from "@/features/pipeline/types";
import { formatCalendarDate, formatCurrency, formatDateTime, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { horizonRange, type Horizon } from "./chart-logic";
import { TASK_OUTCOMES, taskOutcome, timingOf, type TaskOutcome } from "./outcome";
import type { DashboardWorker } from "./types";
import { dealKind, useWorkerDeals, useWorkerTasks, type DashboardTask } from "./work-queries";

const PERIODS = ["month", "quarter", "year"] as const;
type Period = (typeof PERIODS)[number];
const ALL = "all";

/** Outcome colours as static classes, so Tailwind sees every name. */
const OUTCOME_CLASSES: Record<TaskOutcome, { pill: string; dot: string }> = {
  onTime: { pill: "border-green/30 bg-green/10 text-green", dot: "bg-green" },
  late: { pill: "border-orange/30 bg-orange/10 text-orange", dot: "bg-orange" },
  missed: { pill: "border-pink/30 bg-pink/10 text-pink", dot: "bg-pink" },
  open: { pill: "border-line bg-surface-hover text-ink-soft", dot: "bg-ink-muted" },
};

/**
 * What the person looks after: the deals in their care (a row opens the
 * deal), their open tasks and below them the history of every task with how
 * it turned out, filtered by result and period.
 */
export function WorkTab({
  worker,
  onOpenDeal,
}: {
  worker: DashboardWorker;
  onOpenDeal: (dealId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <WorkDeals worker={worker} onOpenDeal={onOpenDeal} />
      <WorkTasks worker={worker} />
    </div>
  );
}

function WorkDeals({
  worker,
  onOpenDeal,
}: {
  worker: DashboardWorker;
  onOpenDeal: (dealId: string) => void;
}) {
  const t = useTranslations("workers.dashboard.work.deals");
  const settings = useFormatSettings();
  const seeAmounts = useCan("pipeline", "see_amounts");
  const deals = useWorkerDeals(worker.id, worker.userId);
  const stages = useStages();

  const sorted = useMemo(() => {
    const list = deals.data ?? [];
    const order = { open: 0, won: 1, lost: 2 } as const;
    return [...list].sort((a, b) => {
      const kind = order[dealKind(a, stages.data ?? [])] - order[dealKind(b, stages.data ?? [])];
      if (kind) return kind;
      const close = (a.expected_close_date ?? "9999").localeCompare(
        b.expected_close_date ?? "9999",
      );
      return close || b.created_at.localeCompare(a.created_at);
    });
  }, [deals.data, stages.data]);

  return (
    <GlowCard interactive={false} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">{t("title")}</h3>
      {deals.isError || stages.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : deals.isPending || stages.isPending ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : sorted.length === 0 ? (
        <p className="py-4 text-sm text-ink-muted">{worker.userId ? t("empty") : t("noAccount")}</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {sorted.map((deal) => {
            const stage = stages.data?.find((item) => item.id === deal.stage_id);
            return (
              <li key={deal.id}>
                <button
                  type="button"
                  data-testid="worker-deal-row"
                  onClick={() => onOpenDeal(deal.id)}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                    <span className="truncate text-sm font-medium text-ink">{deal.title}</span>
                    {stage && (
                      <StatusPill tone={stageTone(stage.color)} className="self-start sm:self-auto">
                        {stage.name}
                      </StatusPill>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-ink-muted">
                    {seeAmounts && deal.value !== null && (
                      <span className="text-sm font-semibold text-ink tabular-nums">
                        {formatCurrency(deal.value, deal.currency, settings)}
                      </span>
                    )}
                    <span>
                      {deal.expected_close_date
                        ? t("closeDate", {
                            date: formatCalendarDate(deal.expected_close_date, settings),
                          })
                        : t("noCloseDate")}
                    </span>
                  </span>
                  <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </GlowCard>
  );
}

function WorkTasks({ worker }: { worker: DashboardWorker }) {
  const t = useTranslations("workers.dashboard.work.tasks");
  const settings = useFormatSettings();
  const [now] = useState(() => new Date());
  const today = todayIsoDate(settings, now);
  const [period, setPeriod] = useState<Period>("month");
  const [outcome, setOutcome] = useState<TaskOutcome | typeof ALL>(ALL);
  const range = useMemo(
    () => horizonRange({ kind: period } as Horizon, today, settings),
    [period, today, settings],
  );
  const tasks = useWorkerTasks(worker.id, worker.userId, range);

  const { open, history } = useMemo(() => {
    const rows = (tasks.data ?? []).map((task) => ({
      task,
      outcome: taskOutcome(task, now, settings),
    }));
    const passes = (row: { outcome: TaskOutcome }) => outcome === ALL || row.outcome === outcome;
    const sorted = sortTasks(rows, (row) => timingOf(row.task), settings.timeZone).filter(passes);
    return {
      open: sorted.filter((row) => !row.task.done),
      history: sorted.filter((row) => row.task.done),
    };
  }, [tasks.data, now, settings, outcome]);

  const outcomeOptions = [
    { value: ALL, label: t("filter.allOutcomes") },
    ...TASK_OUTCOMES.map((value) => ({ value, label: t(`outcome.${value}`) })),
  ];
  const periodOptions = PERIODS.map((value) => ({ value, label: t(`period.${value}`) }));

  return (
    <GlowCard interactive={false} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold text-ink">{t("title")}</h3>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <span id="worker-task-outcome" className="sr-only">
            {t("filter.outcome")}
          </span>
          <Select
            value={outcome}
            items={outcomeOptions}
            onValueChange={(next) => setOutcome((next as TaskOutcome | typeof ALL) ?? ALL)}
          >
            <SelectTrigger aria-labelledby="worker-task-outcome" className="sm:min-w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {outcomeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span id="worker-task-period" className="sr-only">
            {t("filter.period")}
          </span>
          <Select
            value={period}
            items={periodOptions}
            onValueChange={(next) => next && setPeriod(next as Period)}
          >
            <SelectTrigger aria-labelledby="worker-task-period" className="sm:min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {tasks.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : tasks.isPending ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : (
        <>
          <section aria-labelledby="worker-open-tasks" className="flex flex-col gap-1">
            <h4 id="worker-open-tasks" className="micro-label">
              {t("open")}
            </h4>
            {open.length === 0 ? (
              <p className="py-2 text-sm text-ink-muted">{t("openEmpty")}</p>
            ) : (
              <TaskRows rows={open} />
            )}
          </section>
          <section aria-labelledby="worker-task-history" className="flex flex-col gap-1">
            <h4 id="worker-task-history" className="micro-label">
              {t("history")}
            </h4>
            {history.length === 0 ? (
              <p className="py-2 text-sm text-ink-muted">{t("historyEmpty")}</p>
            ) : (
              <TaskRows rows={history} />
            )}
          </section>
        </>
      )}
    </GlowCard>
  );
}

function TaskRows({ rows }: { rows: { task: DashboardTask; outcome: TaskOutcome }[] }) {
  const t = useTranslations("workers.dashboard.work.tasks");
  const settings = useFormatSettings();

  function due(task: DashboardTask) {
    if (task.dueAt) return t("due", { date: formatDateTime(new Date(task.dueAt), settings) });
    if (task.dueDay) return t("due", { date: formatCalendarDate(task.dueDay, settings) });
    return t("noDue");
  }

  return (
    <ul className="-mx-2 flex flex-col">
      {rows.map(({ task, outcome }) => {
        const body = (
          <>
            <span
              aria-hidden
              className={cn("size-2 shrink-0 rounded-full", OUTCOME_CLASSES[outcome].dot)}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-ink">{task.title}</span>
              <span className="text-xs text-ink-muted">
                {t(`origin.${task.origin}`)} · {due(task)}
              </span>
            </span>
            <span
              className={cn(
                "inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap",
                OUTCOME_CLASSES[outcome].pill,
              )}
            >
              {t(`outcome.${outcome}`)}
            </span>
          </>
        );
        const rowClass = "flex min-h-11 items-center gap-3 rounded-xl px-2 py-2";
        return (
          <li
            key={`${task.origin}-${task.id}`}
            data-testid="worker-task-row"
            data-outcome={outcome}
          >
            {task.origin === "crm" ? (
              <Link
                href={`${TASKS_PATH}?task=${task.id}`}
                className={cn(
                  rowClass,
                  "outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40",
                )}
              >
                {body}
              </Link>
            ) : (
              <div className={rowClass}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
