import { isOverdue, type TaskTiming } from "@/features/crm-tasks/logic";
import { instantToZonedParts, type FormatSettings, type IsoDate } from "@/lib/format";

/**
 * How one task of a person turned out, for the dashboard: done in time
 * (green), done late (orange), not done and past due (red), or still open.
 * Sales tasks have a due moment, tasks from the owner only a due day.
 */
export const TASK_OUTCOMES = ["onTime", "late", "missed", "open"] as const;
export type TaskOutcome = (typeof TASK_OUTCOMES)[number];

/** The colour token of each outcome; "open" is no judgement yet. */
export const OUTCOME_COLOR: Record<TaskOutcome, "green" | "orange" | "pink" | "ink-muted"> = {
  onTime: "green",
  late: "orange",
  missed: "pink",
  open: "ink-muted",
};

/** A task of either kind, as the dashboard reads it. */
export type WorkTask = {
  id: string;
  /** Sales task (crm_tasks) or a task from the owner (worker_tasks). */
  origin: "crm" | "owner";
  title: string;
  done: boolean;
  /** Due moment of a sales task. */
  dueAt: string | null;
  /** Due day (no time) of a task from the owner. */
  dueDay: IsoDate | null;
  completedAt: string | null;
  createdAt: string;
};

const MINUTE_MS = 60_000;

export function timingOf(task: WorkTask): TaskTiming {
  return {
    id: task.id,
    done: task.done,
    dueAt: task.dueAt,
    dueDay: task.dueDay,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
  };
}

/**
 * Done by the due moment counts to the minute (finished at 15:00:40 for 15:00
 * is in time); a due day counts until its end in the user's zone. A done task
 * without a due date is in time. An open one is missed once it is overdue
 * (the same rule as the Tasks section).
 */
export function taskOutcome(task: WorkTask, now: Date, settings: FormatSettings): TaskOutcome {
  if (task.done) {
    if (!task.completedAt) return "onTime";
    if (task.dueAt) {
      const finished = Math.floor(Date.parse(task.completedAt) / MINUTE_MS);
      const due = Math.floor(Date.parse(task.dueAt) / MINUTE_MS);
      return finished <= due ? "onTime" : "late";
    }
    if (task.dueDay) {
      const finishedOn = instantToZonedParts(new Date(task.completedAt), settings.timeZone).date;
      return finishedOn <= task.dueDay ? "onTime" : "late";
    }
    return "onTime";
  }
  return isOverdue(timingOf(task), now, settings) ? "missed" : "open";
}

/** The day an outcome belongs to in the charts: when it was done, or when it was due. */
export function outcomeDay(
  task: WorkTask,
  outcome: TaskOutcome,
  settings: FormatSettings,
): IsoDate | null {
  if (outcome === "onTime" || outcome === "late") {
    if (!task.completedAt) return null;
    return instantToZonedParts(new Date(task.completedAt), settings.timeZone).date;
  }
  if (outcome === "missed") {
    if (task.dueAt) return instantToZonedParts(new Date(task.dueAt), settings.timeZone).date;
    return task.dueDay;
  }
  return null;
}
