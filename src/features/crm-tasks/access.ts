import { canAccess, canAccessContacts, type Workspace } from "@/features/account/workspace";
import type { CrmTask } from "./types";

/**
 * What the account may do with a task, mirroring the row security of
 * crm_tasks (which decides for real): the owner everything; a worker who may
 * edit the deal's or the contact's section changes it; the person it is given
 * to may tick it off. Nothing in a read-only space.
 */

type TaskRefs = Pick<CrmTask, "deal_id" | "contact_id" | "assignee_id">;

export function canEditTask(workspace: Workspace, task: TaskRefs): boolean {
  if (workspace.readOnly) return false;
  if (workspace.role === "owner") return true;
  return (
    (task.deal_id !== null && canAccess(workspace, "pipeline", "edit")) ||
    (task.contact_id !== null && canAccessContacts(workspace, "edit"))
  );
}

export function canTickTask(workspace: Workspace, task: TaskRefs): boolean {
  if (workspace.readOnly) return false;
  return canEditTask(workspace, task) || task.assignee_id === workspace.userId;
}

/** Whether a new task may be made for a deal, a contact or (on the Tasks page) for anything. */
export function canCreateTask(
  workspace: Workspace,
  target: { deal: boolean; contact: boolean } | "any",
): boolean {
  if (workspace.readOnly) return false;
  if (workspace.role === "owner") return true;
  const deals = canAccess(workspace, "pipeline", "edit");
  const contacts = canAccessContacts(workspace, "edit");
  if (target === "any") return deals || contacts;
  return (target.deal && deals) || (target.contact && contacts);
}
