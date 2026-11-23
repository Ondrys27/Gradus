import { navItemsFor } from "@/components/layout/nav-items";
import { can, workspaceFor } from "@/features/account/workspace";
import type { GrantSection, PermissionGrants } from "@/features/workers/permissions-catalog";
import type { WidgetAccess } from "./access";

/**
 * The widget access a worker with these rights has in the owner's company,
 * computed on the owner's side (the Rights tab's list of widgets): the same
 * rules as the worker's own app (workspace.ts, nav-items.ts), never game locks.
 */
export function workerWidgetAccess(
  grants: PermissionGrants,
  allowList: readonly string[] | null = null,
): WidgetAccess {
  const workspace = workspaceFor("worker-account", { id: "worker", ownerId: "owner" }, grants);
  const navOpen = new Set<string>(
    navItemsFor({
      permissions: workspace.permissions,
      company: can(workspace, "company", "view"),
      scheduler: can(workspace, "scheduler", "own"),
    }).map((item) => item.key),
  );
  return {
    role: "worker",
    can: (section, action) => can(workspace, section as GrantSection, action as never),
    navOpen,
    playing: false,
    allowList,
  };
}

/**
 * What the owner composes a company default from: every widget a worker could
 * have. Each worker then sees only what their own rights allow.
 */
export const TEMPLATE_ACCESS: WidgetAccess = {
  role: "worker",
  can: () => true,
  navOpen: new Set([
    "dashboard",
    "milestones",
    "notes",
    "contacts",
    "pipeline",
    "tasks",
    "coldCalling",
    "calendar",
    "scheduler",
    "finance",
    "messages",
    "workers",
    "myRewards",
  ]),
  playing: false,
  allowList: null,
};
