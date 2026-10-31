import type { Database } from "@/types/database";
import type { WorkerTask } from "@/features/workers/types";

type Tables = Database["public"]["Tables"];

export type CrmTaskStatus = Database["public"]["Enums"]["crm_task_status"];

/** Every list reads these; the deal and the contact come along for the link. */
export const CRM_TASK_COLUMNS =
  "id, title, description, due_at, duration_minutes, assignee_id, deal_id, contact_id, status, completed_at, completed_by, completion_note, created_by, created_at, deal:deals(id, title), contact:contacts(id, company_name, first_name, last_name)";

export type CrmTaskContact = Pick<
  Tables["contacts"]["Row"],
  "id" | "company_name" | "first_name" | "last_name"
>;

export type CrmTask = Pick<
  Tables["crm_tasks"]["Row"],
  | "id"
  | "title"
  | "description"
  | "due_at"
  | "duration_minutes"
  | "assignee_id"
  | "deal_id"
  | "contact_id"
  | "status"
  | "completed_at"
  | "completed_by"
  | "completion_note"
  | "created_by"
  | "created_at"
> & {
  /** Null when the deal is gone or the viewer may not see the pipeline. */
  deal: { id: string; title: string } | null;
  contact: CrmTaskContact | null;
};

/** Someone a task can be given to: the owner of the space or one of its workers. */
export type Assignee = { userId: string; name: string; isOwner: boolean };

/** Where a task is made from; the dialog is the same everywhere. */
export type TaskOrigin = "deal" | "contact" | "tasks";

/** What a task belongs to, as the dialog shows and saves it. */
export type TaskTarget = {
  deal: { id: string; title: string } | null;
  contact: CrmTaskContact | null;
};

/**
 * One row of the Tasks section: a sales task, or for a worker also a task the
 * owner gave them in Workers (worker_tasks), shown with where it comes from.
 */
export type ListItem =
  { kind: "crm"; key: string; task: CrmTask } | { kind: "owner"; key: string; task: WorkerTask };

/** Where the task is in the app, for "Open deal" / "Open contact". */
export function dealHref(dealId: string): string {
  return `/app/pipeline?deal=${dealId}`;
}
export function contactHref(contactId: string): string {
  return `/app/kontakty/${contactId}`;
}
export const TASKS_PATH = "/app/ukoly-crm";
