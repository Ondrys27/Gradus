import { describe, expect, it } from "vitest";
import {
  accessLabel,
  availableTargets,
  canManageShare,
  canShare,
  canWriteNote,
  folderCounts,
  folderTree,
  grantableRoles,
  higherRole,
  nextFolderPosition,
  notesInScope,
  parentChoices,
  parseScope,
  scopeSearch,
  sharingErrorKey,
  sortAccess,
  visibleFaces,
  writableFolders,
  type AccessEntry,
  type FolderItem,
} from "./logic";

function folder(patch: Partial<FolderItem> & { id: string }): FolderItem {
  return {
    parentId: null,
    name: patch.id,
    color: "violet",
    position: 0,
    ownerId: "me",
    ownerName: null,
    role: "owner",
    canReshare: true,
    shared: false,
    ...patch,
  };
}

function entry(patch: Partial<AccessEntry>): AccessEntry {
  return {
    entry: "share",
    source: "direct",
    shareId: "s",
    targetKind: "member",
    userId: null,
    groupId: null,
    name: null,
    avatarUrl: null,
    memberCount: null,
    role: "viewer",
    canReshare: false,
    createdBy: null,
    ...patch,
  };
}

describe("roles", () => {
  it("writes as owner or editor, shares further as owner or when allowed", () => {
    expect(canWriteNote("owner")).toBe(true);
    expect(canWriteNote("editor")).toBe(true);
    expect(canWriteNote("viewer")).toBe(false);
    expect(canWriteNote(null)).toBe(false);
    expect(canShare("owner", false)).toBe(true);
    expect(canShare("viewer", true)).toBe(true);
    expect(canShare("editor", false)).toBe(false);
    expect(canShare(undefined, true)).toBe(false);
  });

  it("never gives more than one's own role", () => {
    expect(grantableRoles("owner")).toEqual(["viewer", "editor"]);
    expect(grantableRoles("editor")).toEqual(["viewer", "editor"]);
    expect(grantableRoles("viewer")).toEqual(["viewer"]);
    expect(grantableRoles(null)).toEqual([]);
    expect(higherRole("viewer", "editor")).toBe("editor");
    expect(higherRole("owner", "editor")).toBe("owner");
  });

  it("lets the owner manage every share, others only their own", () => {
    expect(canManageShare({ created_by: "x" }, "me", "owner")).toBe(true);
    expect(canManageShare({ created_by: "me" }, "me", "viewer")).toBe(true);
    expect(canManageShare({ created_by: "x" }, "me", "editor")).toBe(false);
  });
});

describe("the folder tree", () => {
  const folders = [
    folder({ id: "b", position: 1 }),
    folder({ id: "a", position: 0 }),
    folder({ id: "a1", parentId: "a", position: 1 }),
    folder({ id: "a0", parentId: "a", position: 0 }),
    // Only the subfolder was shared with the account: it stands at the top.
    folder({ id: "orphan", parentId: "hidden", role: "viewer" }),
  ];

  it("puts subfolders under their parent in order, orphans at the top", () => {
    const tree = folderTree(folders);
    expect(tree.map((node) => node.id)).toEqual(["a", "orphan", "b"]);
    expect(tree[0].children.map((child) => child.id)).toEqual(["a0", "a1"]);
  });

  it("offers as parents only own top folders, and none to a folder with subfolders", () => {
    expect(parentChoices(folders, "b").map((f) => f.id)).toEqual(["a"]);
    expect(parentChoices(folders, "a")).toEqual([]);
    expect(parentChoices(folders, null).map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("moves notes only into folders the account owns or edits", () => {
    const list = [folder({ id: "own" }), folder({ id: "edit", role: "editor" }), folder({ id: "view", role: "viewer" })];
    expect(writableFolders(list).map((f) => f.id)).toEqual(["own", "edit"]);
  });

  it("places a new folder after its siblings", () => {
    expect(nextFolderPosition(folders, null)).toBe(2);
    expect(nextFolderPosition(folders, "a")).toBe(2);
    expect(nextFolderPosition(folders, "b")).toBe(0);
  });
});

describe("the side panel", () => {
  const folders = [folder({ id: "top" }), folder({ id: "sub", parentId: "top" })];
  const notes = [
    { id: "1", role: "owner" as const, folder_id: null },
    { id: "2", role: "owner" as const, folder_id: "sub" },
    { id: "3", role: "editor" as const, folder_id: "top" },
    { id: "4", role: "viewer" as const, folder_id: null },
    // Made here, not saved yet: the account's own.
    { id: "5", folder_id: null },
  ];

  it("splits mine, shared with me and a folder with its subfolders", () => {
    expect(notesInScope(notes, { kind: "mine" }).map((n) => n.id)).toEqual(["1", "2", "5"]);
    expect(notesInScope(notes, { kind: "shared" }).map((n) => n.id)).toEqual(["3", "4"]);
    expect(notesInScope(notes, { kind: "folder", id: "top" }, folders).map((n) => n.id)).toEqual(["2", "3"]);
    expect(notesInScope(notes, { kind: "folder", id: "sub" }, folders).map((n) => n.id)).toEqual(["2"]);
  });

  it("counts a subfolder's notes in its top folder too", () => {
    const counts = folderCounts(notes, folders);
    expect(counts.get("top")).toBe(2);
    expect(counts.get("sub")).toBe(1);
  });

  it("reads and writes the part of the panel in the address", () => {
    const id = "6f1d3c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    expect(parseScope(new URLSearchParams(`folder=${id}`))).toEqual({ kind: "folder", id });
    expect(parseScope(new URLSearchParams("folder=../x"))).toEqual({ kind: "mine" });
    expect(parseScope(new URLSearchParams("shared=1"))).toEqual({ kind: "shared" });
    expect(parseScope(new URLSearchParams(""))).toEqual({ kind: "mine" });
    expect(scopeSearch({ kind: "folder", id })).toEqual({ folder: id });
    expect(scopeSearch({ kind: "mine" })).toEqual({});
  });
});

describe("who has access", () => {
  it("is private with the owner alone, shared (n) with others", () => {
    const owner = { userId: "o", name: "O", avatarUrl: null, role: "owner" as const };
    expect(accessLabel([owner])).toEqual({ shared: false, count: 0 });
    expect(
      accessLabel([owner, { ...owner, userId: "a", role: "viewer" }, { ...owner, userId: "b", role: "editor" }]),
    ).toEqual({ shared: true, count: 2 });
    expect(visibleFaces([1, 2, 3, 4, 5, 6], 4)).toEqual({ faces: [1, 2, 3, 4], more: 2 });
  });

  it("lists the owner, the company, groups, then people; direct before inherited", () => {
    const sorted = sortAccess([
      entry({ targetKind: "member", name: "Zdeněk" }),
      entry({ targetKind: "group", source: "folder", name: "Obchod" }),
      entry({ targetKind: "group", name: "Marketing" }),
      entry({ entry: "owner", role: "owner", name: "Jana" }),
      entry({ targetKind: "space" }),
    ]);
    expect(sorted.map((e) => e.name ?? e.targetKind)).toEqual(["Jana", "space", "Marketing", "Obchod", "Zdeněk"]);
  });

  it("offers only who has no direct share yet, never the owner or oneself", () => {
    const people = [{ userId: "owner" }, { userId: "me" }, { userId: "a" }, { userId: "b" }];
    const groups = [{ id: "g1" }, { id: "g2" }];
    const entries = [
      entry({ targetKind: "member", userId: "a" }),
      entry({ targetKind: "group", groupId: "g1" }),
      // Through the folder: a direct share can still decide for this person.
      entry({ targetKind: "member", userId: "b", source: "folder" }),
      entry({ targetKind: "space", source: "folder" }),
    ];
    const result = availableTargets(people, groups, entries, "owner", "me");
    expect(result.people.map((p) => p.userId)).toEqual(["b"]);
    expect(result.groups.map((g) => g.id)).toEqual(["g2"]);
    expect(result.space).toBe(true);
    expect(availableTargets(people, groups, [entry({ targetKind: "space" })], "owner", "me").space).toBe(false);
  });

  it("names the database's refusals", () => {
    expect(sharingErrorKey({ message: "note_share_denied" })).toBe("denied");
    expect(sharingErrorKey({ message: "note_owner_only" })).toBe("denied");
    expect(sharingErrorKey({ message: "note_share_target" })).toBe("target");
    expect(sharingErrorKey({ message: "read_only" })).toBe("readOnly");
    expect(sharingErrorKey({ message: "note_folder_parent" })).toBe("folder");
    expect(sharingErrorKey(new Error("boom"))).toBe("generic");
  });
});
