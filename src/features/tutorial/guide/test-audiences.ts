import { workspaceFor } from "@/features/account/workspace";
import type { PermissionGrants } from "@/features/workers/permissions-catalog";
import { appAudience, type GuideAudience } from "../ui-map/access";

/**
 * The people the guide's tests ask as (30.8): the owner, workers with the
 * rights of 30.2 templates, an administrator. Only for tests.
 */

export const OWNER = appAudience(workspaceFor("owner-1", null));

export function workerWith(grants: PermissionGrants, readOnly = false): GuideAudience {
  return appAudience(workspaceFor("worker-1", { id: "w-1", ownerId: "owner-1" }, grants, readOnly));
}

/** A salesperson: contacts, cold calling, pipeline (own deals), tasks, calendar; no finance. */
export const SALES = workerWith({
  contacts: ["view", "create", "update"],
  cold_calling: ["view", "call"],
  pipeline: ["view", "create", "update", "change_stage"],
  tasks: ["view", "create", "update"],
  calendar: ["view", "create", "update"],
});

/** A worker who may only look at contacts. */
export const VIEWER = workerWith({ contacts: ["view"] });

export const FULL_ADMIN: GuideAudience = { kind: "admin", actor: { role: "admin", level: "full" } };
export const LIMITED_ADMIN: GuideAudience = { kind: "admin", actor: { role: "admin", level: "limited" } };
