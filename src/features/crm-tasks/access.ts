import { can, canAccessContacts, canDo, type Workspace } from "@/features/account/workspace";
import type { CrmTask } from "./types";

/**
 * What the account may do with a task, mirroring the row security of
 * crm_tasks and crm_tasks_permission_guard (which decide for real): the owner
 * everything; a worker by the rights of Tasks (all tasks, create, update,
 * assign to others, delete) on a deal or contact they may see; the person a
 * task is given to may always tick it off. Nothing in a read-only space.
 */

type TaskRefs = Pick<CrmTask, "deal_id" | "contact_id" | "assignee_id"> & {
  /** The deal as read with the task; null when its deal is not the worker's to see. */
  deal?: { id: string } | null;
};

/** The deal (all deals, or one the read returned) or the contact is the worker's to see. */
function targetVisible(workspace: Workspace, task: TaskRefs): boolean {
  if (workspace.role === "owner") return true;
  const deal =
    task.deal_id !== null &&
    can(workspace, "pipeline", "view") &&
    (canDo(workspace, "pipeline", "view_all") || (task.deal !== undefined && task.deal !== null));
  const contact = task.contact_id !== null && canAccessContacts(workspace, "view");
  return deal || contact;
}

export function canEditTask(workspace: Workspace, task: TaskRefs): boolean {
  if (workspace.readOnly) return false;
  if (workspace.role === "owner") return true;
  return (
    canDo(workspace, "tasks", "update") &&
    targetVisible(workspace, task) &&
    (canDo(workspace, "tasks", "view_all") || task.assignee_id === workspace.userId)
  );
}

export function canTickTask(workspace: Workspace, task: TaskRefs): boolean {
  if (workspace.readOnly) return false;
  return canEditTask(workspace, task) || task.assignee_id === workspace.userId;
}

export function canDeleteTask(workspace: Workspace, task: TaskRefs): boolean {
  if (workspace.readOnly) return false;
  if (workspace.role === "owner") return true;
  return (
    canDo(workspace, "tasks", "delete") &&
    (task.assignee_id === workspace.userId ||
      (canDo(workspace, "tasks", "view_all") && targetVisible(workspace, task)))
  );
}

/** Whether a task may be given to someone other than the one making or changing it. */
export function canAssignOthers(workspace: Workspace): boolean {
  if (workspace.readOnly) return false;
  return workspace.role === "owner" || canDo(workspace, "tasks", "assign_others");
}

/** Whether a new task may be made for a deal, a contact or (on the Tasks page) for anything. */
export function canCreateTask(
  workspace: Workspace,
  target: { deal: boolean; contact: boolean } | "any",
): boolean {
  if (workspace.readOnly) return false;
  if (workspace.role === "owner") return true;
  if (!canDo(workspace, "tasks", "create")) return false;
  const deals = can(workspace, "pipeline", "view");
  const contacts = canAccessContacts(workspace, "view");
  if (target === "any") return deals || contacts;
  return (target.deal && deals) || (target.contact && contacts);
}
