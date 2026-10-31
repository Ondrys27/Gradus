import type { WorkerTask } from "@/features/workers/types";
import type { TaskTiming } from "./logic";
import type { CrmTask, ListItem } from "./types";

/** What the grouping and ordering need of a sales task. */
export function crmTiming(
  task: Pick<CrmTask, "id" | "status" | "due_at" | "created_at" | "completed_at">,
): TaskTiming {
  return {
    id: task.id,
    done: task.status === "done",
    dueAt: task.due_at,
    dueDay: null,
    createdAt: task.created_at,
    completedAt: task.completed_at,
  };
}

/** A task from the owner: a due day without a time. */
export function ownerTiming(task: WorkerTask): TaskTiming {
  return {
    id: task.id,
    done: task.status === "done",
    dueAt: null,
    dueDay: task.due_date,
    createdAt: task.created_at,
    completedAt: task.completed_at,
  };
}

export function itemTiming(item: ListItem): TaskTiming {
  return item.kind === "crm" ? crmTiming(item.task) : ownerTiming(item.task);
}
