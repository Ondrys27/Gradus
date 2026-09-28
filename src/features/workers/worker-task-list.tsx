"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarClockIcon, ChevronRightIcon, ListChecksIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Pager } from "@/features/finance/pager";
import { formatCalendarDate, formatDate, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { PAGE_SIZE } from "./logic";
import { useDoneWorkerTasks, useOpenWorkerTasks, useSetWorkerTaskStatus } from "./queries";
import type { WorkerTask } from "./types";

type Props = {
  workerId: string;
  /** The worker ticks tasks off; the owner opens them to edit. */
  mode: "worker" | "owner";
  onOpen?: (task: WorkerTask) => void;
};

/** Open tasks by due date, then the done ones, twenty a page. */
export function WorkerTaskList({ workerId, mode, onOpen }: Props) {
  const t = useTranslations("workers.tasks");
  const open = useOpenWorkerTasks(workerId);
  const [page, setPage] = useState(0);
  const done = useDoneWorkerTasks(workerId, page);
  const setStatus = useSetWorkerTaskStatus();

  if (open.isError || done.isError) return <FormAlert>{t("loadFailed")}</FormAlert>;
  if (!open.data || !done.data) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  const toggle = (task: WorkerTask) =>
    setStatus.mutate({ id: task.id, status: task.status === "done" ? "todo" : "done" });

  if (open.data.length === 0 && done.data.total === 0) {
    return (
      <EmptyState
        icon={<ListChecksIcon />}
        title={t(mode === "worker" ? "emptyWorkerTitle" : "emptyTitle")}
        description={t(mode === "worker" ? "emptyWorkerDescription" : "emptyDescription")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {setStatus.isError && <FormAlert>{t("toggleFailed")}</FormAlert>}
      <section className="flex flex-col gap-2" aria-labelledby={`open-tasks-${workerId}`}>
        <h3 id={`open-tasks-${workerId}`} className="micro-label">
          {t("open")}
        </h3>
        {open.data.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("allDone")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {open.data.map((task) => (
              <TaskRow key={task.id} task={task} mode={mode} onToggle={toggle} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </section>

      {done.data.total > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby={`done-tasks-${workerId}`}>
          <h3 id={`done-tasks-${workerId}`} className="micro-label">
            {t("done")}
          </h3>
          <ul className="flex flex-col gap-2">
            {done.data.rows.map((task) => (
              <TaskRow key={task.id} task={task} mode={mode} onToggle={toggle} onOpen={onOpen} />
            ))}
          </ul>
          <Pager
            page={page}
            pages={Math.max(1, Math.ceil(done.data.total / PAGE_SIZE))}
            onPage={setPage}
          />
        </section>
      )}
    </div>
  );
}

function TaskRow({
  task,
  mode,
  onToggle,
  onOpen,
}: {
  task: WorkerTask;
  mode: "worker" | "owner";
  onToggle: (task: WorkerTask) => void;
  onOpen?: (task: WorkerTask) => void;
}) {
  const t = useTranslations("workers.tasks");
  const settings = useFormatSettings();
  const reduceMotion = useReducedMotion();
  const isDone = task.status === "done";
  const overdue = !isDone && task.due_date !== null && task.due_date < todayIsoDate(settings);
  const [pops, setPops] = useState(0);

  const meta = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
      {task.due_date && (
        <span className={cn("inline-flex items-center gap-1", overdue && "text-pink")}>
          <CalendarClockIcon aria-hidden className="size-3.5" />
          {overdue
            ? t("overdue", { date: formatCalendarDate(task.due_date, settings) })
            : t("due", { date: formatCalendarDate(task.due_date, settings) })}
        </span>
      )}
      {isDone && task.completed_at && (
        <span>{t("completedOn", { date: formatDate(new Date(task.completed_at), settings) })}</span>
      )}
    </span>
  );

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-line bg-surface/70 px-4 py-3">
      {mode === "worker" ? (
        <motion.span
          key={pops}
          initial={pops > 0 && !reduceMotion ? { scale: 0.7 } : false}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 18 }}
          className="flex"
        >
          <Checkbox
            checked={isDone}
            aria-label={isDone ? t("reopen", { title: task.title }) : t("complete", { title: task.title })}
            onCheckedChange={() => {
              if (!isDone) setPops((count) => count + 1);
              onToggle(task);
            }}
          />
        </motion.span>
      ) : (
        <StatusPill tone={isDone ? "green" : task.status === "in_progress" ? "teal" : "neutral"}>
          {t(`status.${task.status}`)}
        </StatusPill>
      )}
      {mode === "owner" && onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cn("text-sm text-ink [overflow-wrap:anywhere]", isDone && "text-ink-soft")}>
              {task.title}
            </span>
            {meta}
          </span>
          <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={cn(
              "text-sm text-ink [overflow-wrap:anywhere]",
              isDone && "text-ink-soft line-through decoration-ink-muted/60",
            )}
          >
            {task.title}
          </span>
          {task.description && (
            <span className="text-xs whitespace-pre-line text-ink-soft [overflow-wrap:anywhere]">
              {task.description}
            </span>
          )}
          {meta}
        </span>
      )}
    </li>
  );
}
