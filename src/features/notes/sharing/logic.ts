/**
 * Folders and sharing of notes (step 28.3), without React: roles, what a
 * role lets the screen offer, the folder tree, which notes a part of the
 * side panel shows and the label of the header. The database decides
 * (note_roles_of, RLS, note_share_set); this only shapes the interface the
 * same way. Vitest in logic.test.ts.
 */

export const NOTE_ROLES = ["owner", "editor", "viewer"] as const;
export type NoteRole = (typeof NOTE_ROLES)[number];
export type ShareRole = Exclude<NoteRole, "owner">;
export const SHARE_ROLES: readonly ShareRole[] = ["viewer", "editor"];

export const SHARE_TARGETS = ["member", "group", "space"] as const;
export type ShareTarget = (typeof SHARE_TARGETS)[number];

export const FOLDER_COLORS = ["violet", "teal", "gold", "green", "orange", "pink"] as const;
export type FolderColor = (typeof FOLDER_COLORS)[number];

export function isNoteRole(value: unknown): value is NoteRole {
  return typeof value === "string" && (NOTE_ROLES as readonly string[]).includes(value);
}

export function noteRoleOf(value: unknown): NoteRole {
  return isNoteRole(value) ? value : "viewer";
}

export function folderColorOf(value: unknown): FolderColor {
  return typeof value === "string" && (FOLDER_COLORS as readonly string[]).includes(value)
    ? (value as FolderColor)
    : "violet";
}

const RANK: Record<NoteRole, number> = { viewer: 1, editor: 2, owner: 3 };

/** The higher of two roles. */
export function higherRole(a: NoteRole, b: NoteRole): NoteRole {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Writing the text: the owner and an editor. */
export function canWriteNote(role: NoteRole | null | undefined): boolean {
  return role === "owner" || role === "editor";
}

/** Deleting, pinning, moving between folders, "private in this folder": the owner only. */
export function isNoteOwner(role: NoteRole | null | undefined): boolean {
  return role === "owner";
}

/** Sharing further: the owner, or whoever was allowed to. */
export function canShare(role: NoteRole | null | undefined, canReshare: boolean): boolean {
  return role === "owner" || (!!role && canReshare);
}

/** The roles someone may give: never more than their own. */
export function grantableRoles(role: NoteRole | null | undefined): ShareRole[] {
  if (role === "owner" || role === "editor") return ["viewer", "editor"];
  if (role === "viewer") return ["viewer"];
  return [];
}

/** Whether someone may change or remove a share: the item's owner any, others the ones they made. */
export function canManageShare(
  share: { created_by: string | null },
  me: string,
  myRole: NoteRole | null | undefined,
): boolean {
  return myRole === "owner" || share.created_by === me;
}

// ---------------------------------------------------------------------------
// The folder tree
// ---------------------------------------------------------------------------

export type FolderItem = {
  id: string;
  parentId: string | null;
  name: string;
  color: FolderColor;
  position: number;
  ownerId: string;
  ownerName: string | null;
  role: NoteRole;
  canReshare: boolean;
  shared: boolean;
};

export type FolderNode = FolderItem & { children: FolderItem[] };

function byPosition(a: FolderItem, b: FolderItem): number {
  return a.position - b.position || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * Top folders with their subfolders, one level deep. A subfolder whose
 * parent the account does not see (only the subfolder was shared) stands
 * at the top on its own.
 */
export function folderTree(folders: readonly FolderItem[]): FolderNode[] {
  const ids = new Set(folders.map((folder) => folder.id));
  const top = folders.filter((folder) => !folder.parentId || !ids.has(folder.parentId)).sort(byPosition);
  return top.map((folder) => ({
    ...folder,
    children: folders.filter((child) => child.parentId === folder.id).sort(byPosition),
  }));
}

/** Folders a note may be moved into: the account's own and those it edits. */
export function writableFolders(folders: readonly FolderItem[]): FolderItem[] {
  return folders.filter((folder) => folder.role === "owner" || folder.role === "editor");
}

/** Places a new top folder at the end of the own ones. */
export function nextFolderPosition(folders: readonly FolderItem[], parentId: string | null): number {
  const siblings = folders.filter((folder) => (folder.parentId ?? null) === parentId);
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((folder) => folder.position)) + 1;
}

/**
 * A folder can go under another one only when it has no subfolders, the
 * other one is a top folder and both are the account's own.
 */
export function parentChoices(folders: readonly FolderItem[], folderId: string | null): FolderItem[] {
  const hasChildren = !!folderId && folders.some((folder) => folder.parentId === folderId);
  if (hasChildren) return [];
  return folders
    .filter((folder) => folder.role === "owner" && !folder.parentId && folder.id !== folderId)
    .sort(byPosition);
}

// ---------------------------------------------------------------------------
// The side panel: which notes a part of it shows
// ---------------------------------------------------------------------------

export type NoteScope =
  | { kind: "mine" }
  | { kind: "shared" }
  | { kind: "folder"; id: string };

export type ScopedNote = {
  /** Absent for a note made here and not saved yet: the account's own. */
  role?: NoteRole;
  folder_id?: string | null;
};

const roleOfNote = (note: ScopedNote): NoteRole => note.role ?? "owner";

/** "?folder=<id>" or "?shared=1" in the address; anything else is My notes. */
export function parseScope(params: { get(name: string): string | null }): NoteScope {
  const folder = params.get("folder");
  if (folder && /^[0-9a-f-]{36}$/i.test(folder)) return { kind: "folder", id: folder };
  if (params.get("shared") === "1") return { kind: "shared" };
  return { kind: "mine" };
}

export function scopeSearch(scope: NoteScope): Record<string, string> {
  if (scope.kind === "folder") return { folder: scope.id };
  if (scope.kind === "shared") return { shared: "1" };
  return {};
}

/**
 * My notes = the account's own (in any folder), Shared with me = what others
 * share with it, a folder = every note in it and in its subfolders that the
 * account reaches.
 */
export function notesInScope<T extends ScopedNote>(
  notes: readonly T[],
  scope: NoteScope,
  folders: readonly FolderItem[] = [],
): T[] {
  if (scope.kind === "mine") return notes.filter((note) => roleOfNote(note) === "owner");
  if (scope.kind === "shared") return notes.filter((note) => roleOfNote(note) !== "owner");
  const inside = new Set([
    scope.id,
    ...folders.filter((folder) => folder.parentId === scope.id).map((folder) => folder.id),
  ]);
  return notes.filter((note) => !!note.folder_id && inside.has(note.folder_id));
}

/** How many notes each folder holds (its subfolders included in a top folder). */
export function folderCounts(
  notes: readonly ScopedNote[],
  folders: readonly FolderItem[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const parentOf = new Map(folders.map((folder) => [folder.id, folder.parentId]));
  for (const note of notes) {
    if (!note.folder_id) continue;
    counts.set(note.folder_id, (counts.get(note.folder_id) ?? 0) + 1);
    const parent = parentOf.get(note.folder_id);
    if (parent) counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Who has access
// ---------------------------------------------------------------------------

export type AccessPerson = { userId: string; name: string; avatarUrl: string | null; role: NoteRole };

/** Private, or shared with n people besides the owner. */
export function accessLabel(people: readonly AccessPerson[]): { shared: boolean; count: number } {
  const count = people.filter((person) => person.role !== "owner").length;
  return { shared: count > 0, count };
}

/** At most `max` faces in the header; the rest as "+n". */
export function visibleFaces<T>(people: readonly T[], max = 4): { faces: T[]; more: number } {
  return { faces: people.slice(0, max), more: Math.max(0, people.length - max) };
}

export type AccessEntry = {
  entry: "owner" | "share" | "folder_owner";
  source: "direct" | "folder";
  shareId: string | null;
  targetKind: ShareTarget;
  userId: string | null;
  groupId: string | null;
  name: string | null;
  avatarUrl: string | null;
  memberCount: number | null;
  role: NoteRole;
  canReshare: boolean;
  createdBy: string | null;
};

/** The owner first, then the whole company, groups and people; direct before inherited. */
export function sortAccess(entries: readonly AccessEntry[]): AccessEntry[] {
  const order = (entry: AccessEntry) =>
    entry.entry === "owner"
      ? 0
      : entry.entry === "folder_owner"
        ? 1
        : entry.targetKind === "space"
          ? 2
          : entry.targetKind === "group"
            ? 3
            : 4;
  return [...entries].sort(
    (a, b) =>
      order(a) - order(b) ||
      (a.source === b.source ? 0 : a.source === "direct" ? -1 : 1) ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

/** People and groups the dialog still offers: not the owner, not already shared directly. */
export function availableTargets<P extends { userId: string }, G extends { id: string }>(
  people: readonly P[],
  groups: readonly G[],
  entries: readonly AccessEntry[],
  ownerId: string,
  me: string,
): { people: P[]; groups: G[]; space: boolean } {
  const direct = entries.filter((entry) => entry.entry === "share" && entry.source === "direct");
  const users = new Set(direct.flatMap((entry) => (entry.targetKind === "member" && entry.userId ? [entry.userId] : [])));
  const groupIds = new Set(direct.flatMap((entry) => (entry.targetKind === "group" && entry.groupId ? [entry.groupId] : [])));
  return {
    people: people.filter((person) => person.userId !== ownerId && person.userId !== me && !users.has(person.userId)),
    groups: groups.filter((group) => !groupIds.has(group.id)),
    space: !direct.some((entry) => entry.targetKind === "space"),
  };
}

/** A database error of sharing and folders as the key of its message. */
export function sharingErrorKey(error: unknown): "denied" | "target" | "readOnly" | "folder" | "generic" {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (message.includes("read_only")) return "readOnly";
  if (message.includes("note_share_denied") || message.includes("note_owner_only")) return "denied";
  if (message.includes("note_share_target")) return "target";
  if (message.includes("note_folder")) return "folder";
  return "generic";
}
