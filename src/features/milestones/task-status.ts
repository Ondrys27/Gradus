import { differenceInCalendarDays } from "date-fns";
import { isoDateToLocal } from "@/lib/format";
import type { Task } from "./types";

/**
 * How a task looks, the same in the map, the list and the legend. A task with
 * open subtasks is locked whatever its own status, until they are all done.
 */
export type TaskVisualState = "todo" | "in_progress" | "done" | "locked";

export const TASK_VISUAL_STATES: TaskVisualState[] = ["todo", "in_progress", "done", "locked"];

export function taskVisualState(
  task: Pick<Task, "status">,
  /** Open direct subtasks. */
  remaining: number,
): TaskVisualState {
  if (task.status === "done") return "done";
  if (remaining > 0) return "locked";
  return task.status;
}

/** Whole days past the due date in the user's time zone; 0 when not overdue or done. */
export function overdueDays(task: Pick<Task, "status" | "due_date">, todayIso: string): number {
  if (task.status === "done" || !task.due_date || task.due_date >= todayIso) return 0;
  return differenceInCalendarDays(isoDateToLocal(todayIso), isoDateToLocal(task.due_date));
}

/**
 * Card look of each state on the map. The live ring of an in-progress task is the
 * `live-ring` utility (a slowly turning conic border, static with reduced motion).
 */
export const taskCardClass: Record<TaskVisualState, string> = {
  todo: "border-line-strong bg-surface hover:border-ink-muted",
  in_progress:
    "live-ring border-transparent bg-[color-mix(in_oklab,var(--color-orange)_6%,var(--color-surface))] shadow-[0_0_26px_-10px_var(--color-orange)]",
  done: "border-teal/70 bg-[color-mix(in_oklab,var(--color-teal)_16%,var(--color-surface))]",
  locked: "border-line bg-surface/60 opacity-70 hover:opacity-90",
};

/** A small chip of each state, for pills and the legend. */
export const taskStateChipClass: Record<TaskVisualState, string> = {
  todo: "border-line-strong bg-surface-hover text-ink-soft",
  in_progress: "border-orange/35 bg-orange/10 text-orange",
  done: "border-teal/35 bg-teal/10 text-teal",
  locked: "border-line bg-surface-hover text-ink-muted",
};
