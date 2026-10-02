import type { WorkerAccess, WorkerAccount } from "./types";

/**
 * A workspace is the owner's account. The owner works in their own; a worker
 * works in the space of the owner who invited them. Mirrors the database
 * functions current_workspace_id() and has_section_access(), which decide for
 * real; here they only shape the interface.
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
  permissions: WorkspacePermissions;
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

export function workspaceFor(
  userId: string,
  worker: Pick<WorkerAccount, "id" | "ownerId"> | null,
  permissions?: Partial<Record<string, WorkerAccess>>,
): Workspace {
  if (!worker) {
    return { id: userId, role: "owner", userId, workerId: null, permissions: {} };
  }
  return {
    id: worker.ownerId,
    role: "worker",
    userId,
    workerId: worker.id,
    permissions: cleanPermissions(permissions),
  };
}

/** The owner may do everything in their space; a worker what the owner granted. */
export function canAccess(
  workspace: Workspace,
  section: WorkspaceSection | "workers" | "settings",
  level: AccessLevel,
): boolean {
  if (workspace.role === "owner") return true;
  if (!isWorkspaceSection(section)) return false;
  const access = workspace.permissions[section];
  if (!access) return false;
  return level === "edit" ? access.edit : access.view || access.edit;
}

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
