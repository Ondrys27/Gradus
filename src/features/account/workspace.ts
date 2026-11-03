import {
  actionKind,
  actionsOf,
  grantAllows,
  isGrantSection,
  legacyAccess,
  sameGrants,
  writesSection,
  type GrantAction,
  type GrantSection,
  type PermissionGrants,
} from "@/features/workers/permissions-catalog";
import type { WorkerAccess, WorkerAccount } from "./types";

/**
 * A workspace is the owner's account. The owner works in their own; a worker
 * works in the space of the owner who invited them. Mirrors the database
 * functions current_workspace_id(), has_section_access() and has_permission(),
 * which decide for real; here they only shape the interface.
 */

/** Sections an owner can open to a worker. Workers and settings never are. */
export const WORKSPACE_SECTIONS = [
  "milestones",
  "contacts",
  "pipeline",
  "cold_calling",
  "calendar",
  "finance",
] as const;

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];
export type AccessLevel = "view" | "edit";
export type WorkspaceRole = "owner" | "worker";
export type WorkspacePermissions = Partial<Record<WorkspaceSection, WorkerAccess>>;

export type Workspace = {
  /** Whose space: the owner's user id. Every shared row carries it as user_id. */
  id: string;
  role: WorkspaceRole;
  /** The signed-in account; the actor of whatever it does. */
  userId: string;
  /** The worker record when the account works for an owner. */
  workerId: string | null;
  /** Coarse view / edit per older section, derived from `grants` like the database does. */
  permissions: WorkspacePermissions;
  /** The fine rights of a worker (worker_permission_grants); empty for an owner. */
  grants: PermissionGrants;
  /** The trial of the workspace ended: everything can be seen, nothing changed. */
  readOnly: boolean;
};

export function isWorkspaceSection(value: string): value is WorkspaceSection {
  return (WORKSPACE_SECTIONS as readonly string[]).includes(value);
}

/** Only the known sections, each read as view / edit with edit including view. */
export function cleanPermissions(
  permissions: Partial<Record<string, WorkerAccess>> | null | undefined,
): WorkspacePermissions {
  const clean: WorkspacePermissions = {};
  for (const [section, access] of Object.entries(permissions ?? {})) {
    if (!access || !isWorkspaceSection(section)) continue;
    clean[section] = { view: access.view || access.edit, edit: access.edit };
  }
  return clean;
}

/** Only known sections and actions, in catalog order; anything else is dropped. */
export function cleanGrants(grants: PermissionGrants | null | undefined): PermissionGrants {
  const clean: Record<string, readonly string[]> = {};
  for (const [section, actions] of Object.entries(grants ?? {})) {
    if (!isGrantSection(section)) continue;
    const listed = (actions ?? []) as readonly string[];
    const kept = actionsOf(section).filter((action) => listed.includes(action));
    if (kept.length > 0) clean[section] = kept;
  }
  return clean as PermissionGrants;
}

/** The older view / edit of the six sections, as worker_permissions_derive() computes it. */
export function permissionsFromGrants(grants: PermissionGrants): WorkspacePermissions {
  const permissions: WorkspacePermissions = {};
  for (const section of WORKSPACE_SECTIONS) {
    const access = legacyAccess(grants, section);
    if (access.view) permissions[section] = access;
  }
  return permissions;
}

export function workspaceFor(
  userId: string,
  worker: Pick<WorkerAccount, "id" | "ownerId"> | null,
  grants?: PermissionGrants,
  readOnly = false,
): Workspace {
  if (!worker) {
    return {
      id: userId,
      role: "owner",
      userId,
      workerId: null,
      permissions: {},
      grants: {},
      readOnly,
    };
  }
  const clean = cleanGrants(grants);
  return {
    id: worker.ownerId,
    role: "worker",
    userId,
    workerId: worker.id,
    permissions: permissionsFromGrants(clean),
    grants: clean,
    readOnly,
  };
}

/**
 * The owner may do everything in their space; a worker what the owner granted.
 * After the trial nobody changes the workspace's data; personal settings stay open.
 */
export function canAccess(
  workspace: Workspace,
  section: WorkspaceSection | "workers" | "settings",
  level: AccessLevel,
): boolean {
  if (level === "edit" && workspace.readOnly && section !== "settings") return false;
  if (workspace.role === "owner") return true;
  if (!isWorkspaceSection(section)) return false;
  const access = workspace.permissions[section];
  if (!access) return false;
  return level === "edit" ? access.edit : access.view || access.edit;
}

/**
 * A fine right (mirrors has_permission()). The owner may do everything in
 * their space; a worker what was granted, always together with the section's
 * "view". "edit" means any write right of the section. After the trial no
 * write right holds.
 */
export function canDo<S extends GrantSection>(
  workspace: Workspace,
  section: S,
  action: GrantAction<S> | "edit",
): boolean {
  const write = action === "edit" || actionKind(section, action) === "write";
  if (write && workspace.readOnly) return false;
  if (workspace.role === "owner") return true;
  if (action === "edit") return writesSection(workspace.grants, section);
  return grantAllows(workspace.grants, section, action);
}

/**
 * useCan's rule: "view" / "edit" of one of the six older sections is the
 * section as a whole (Finance opens with finance or invoices); any other
 * action is the fine right.
 */
export function can<S extends GrantSection>(
  workspace: Workspace,
  section: S,
  action: GrantAction<S> | "edit",
): boolean {
  if ((action === "view" || action === "edit") && isWorkspaceSection(section)) {
    return canAccess(workspace, section, action);
  }
  return canDo(workspace, section, action);
}

/** Two sets of fine rights mean the same. */
export { sameGrants };

/** Contacts and cold calling share their tables: either section opens them. */
export function canAccessContacts(workspace: Workspace, level: AccessLevel): boolean {
  return canAccess(workspace, "contacts", level) || canAccess(workspace, "cold_calling", level);
}

/** Two permission sets mean the same access. */
export function samePermissions(a: WorkspacePermissions, b: WorkspacePermissions): boolean {
  return WORKSPACE_SECTIONS.every(
    (section) =>
      Boolean(a[section]?.view) === Boolean(b[section]?.view) &&
      Boolean(a[section]?.edit) === Boolean(b[section]?.edit),
  );
}
