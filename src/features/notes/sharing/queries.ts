"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import { noteKeys, type NoteDetail, type NoteListItem } from "../queries";
import {
  folderColorOf,
  noteRoleOf,
  type AccessEntry,
  type AccessPerson,
  type FolderColor,
  type FolderItem,
  type ShareRole,
  type ShareTarget,
} from "./logic";

/**
 * Folders, shares, versions and "remove from mine" of notes (step 28.3),
 * always with the signed-in user's own client: the database decides who
 * sees and changes what (RLS and the note_* functions).
 */

/** The item a share or the dialog is about: a note or a folder. */
export type ShareItem = { kind: "note"; id: string } | { kind: "folder"; id: string };

export const sharingKeys = {
  folders: (userId: string, space: string) => ["notes", userId, "folders", space] as const,
  access: (userId: string, item: ShareItem) => ["notes", userId, "access", item.kind, item.id] as const,
  people: (userId: string, item: ShareItem) => ["notes", userId, "people", item.kind, item.id] as const,
  groups: (userId: string, space: string) => ["notes", userId, "share-groups", space] as const,
  versions: (userId: string, noteId: string) => ["notes", userId, "versions", noteId] as const,
};

const params = (item: ShareItem) =>
  item.kind === "note" ? { _note: item.id } : { _folder: item.id };

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function useNoteFolders() {
  const { user } = useSession();
  const { id: space } = useWorkspace();
  return useQuery({
    queryKey: sharingKeys.folders(user.id, space),
    queryFn: async (): Promise<FolderItem[]> => {
      const { data, error } = await createClient().rpc("note_folders_list", { _space: space });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        parentId: row.parent_id ?? null,
        name: row.name,
        color: folderColorOf(row.color),
        position: row.position,
        ownerId: row.owner_id,
        ownerName: row.owner_name ?? null,
        role: noteRoleOf(row.role),
        canReshare: row.can_reshare,
        shared: row.shared,
      }));
    },
    // Someone may share a folder with the account meanwhile.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Who has access to a note or folder and from where (note_access_list). */
export function useNoteAccess(item: ShareItem | null, enabled = true) {
  const { user } = useSession();
  return useQuery({
    queryKey: item ? sharingKeys.access(user.id, item) : ["notes", user.id, "access", "none"],
    queryFn: async (): Promise<AccessEntry[]> => {
      const { data, error } = await createClient().rpc("note_access_list", params(item!));
      if (error) throw error;
      return (data ?? []).map((row) => ({
        entry: row.entry as AccessEntry["entry"],
        source: row.source === "folder" ? "folder" : "direct",
        shareId: row.share_id ?? null,
        targetKind: (row.target_kind ?? "member") as ShareTarget,
        userId: row.user_id ?? null,
        groupId: row.group_id ?? null,
        name: row.name ?? null,
        avatarUrl: row.avatar_url ?? null,
        memberCount: row.member_count ?? null,
        role: noteRoleOf(row.role),
        canReshare: row.can_reshare,
        createdBy: row.created_by ?? null,
      }));
    },
    enabled: enabled && !!item,
  });
}

/** The people who reach a note or folder now, owner first (the faces in the header). */
export function useNotePeople(item: ShareItem | null, enabled = true) {
  const { user } = useSession();
  return useQuery({
    queryKey: item ? sharingKeys.people(user.id, item) : ["notes", user.id, "people", "none"],
    queryFn: async (): Promise<AccessPerson[]> => {
      const { data, error } = await createClient().rpc("note_people", params(item!));
      if (error) throw error;
      return (data ?? []).map((row) => ({
        userId: row.user_id,
        name: row.name ?? "",
        avatarUrl: row.avatar_url ?? null,
        role: noteRoleOf(row.role),
      }));
    },
    enabled: enabled && !!item,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export type ShareGroup = { id: string; name: string; color: string; memberCount: number };

export function useShareGroups(enabled = true) {
  const { user } = useSession();
  const { id: space } = useWorkspace();
  return useQuery({
    queryKey: sharingKeys.groups(user.id, space),
    queryFn: async (): Promise<ShareGroup[]> => {
      const { data, error } = await createClient().rpc("note_share_groups", { _space: space });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        memberCount: row.member_count ?? 0,
      }));
    },
    enabled,
    staleTime: 60_000,
  });
}

export type NoteVersion = {
  id: string;
  savedBy: string | null;
  savedByName: string;
  createdAt: string;
  updatedAt: string;
  kind: "text" | "mindmap";
  title: string;
  excerpt: string;
};

export function useNoteVersions(noteId: string | null, enabled = true) {
  const { user } = useSession();
  return useQuery({
    queryKey: sharingKeys.versions(user.id, noteId ?? ""),
    queryFn: async (): Promise<NoteVersion[]> => {
      const { data, error } = await createClient().rpc("note_versions_list", { _note: noteId!, _limit: 50 });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        savedBy: row.saved_by ?? null,
        savedByName: row.saved_by_name ?? "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        kind: row.kind === "mindmap" ? "mindmap" : "text",
        title: row.title,
        excerpt: row.excerpt ?? "",
      }));
    },
    enabled: enabled && !!noteId,
  });
}

/** The whole stored state of one version, for bringing it back. */
export async function fetchVersion(id: string) {
  const { data, error } = await createClient()
    .from("note_versions")
    .select("id, kind, title, content, content_text")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("version_not_found");
  return data;
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

function invalidateSharing(queryClient: ReturnType<typeof useQueryClient>, userId: string) {
  void queryClient.invalidateQueries({ queryKey: ["notes", userId] });
}

export function useShareSet() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      item: ShareItem;
      target: ShareTarget;
      targetId: string | null;
      role: ShareRole;
      canReshare: boolean;
      /** A change of an existing share, not a new one. */
      change?: boolean;
    }) => {
      const { error } = await createClient().rpc("note_share_set", {
        _note: input.item.kind === "note" ? input.item.id : (null as unknown as string),
        _folder: input.item.kind === "folder" ? input.item.id : (null as unknown as string),
        _target_kind: input.target,
        _target: input.targetId as unknown as string,
        _role: input.role,
        _can_reshare: input.canReshare,
      });
      if (error) throw error;
      if (input.change) {
        track("note_share_updated", { on: input.item.kind, role: input.role, reshare: input.canReshare });
      } else {
        track("note_shared", {
          on: input.item.kind,
          target: input.target,
          role: input.role,
          reshare: input.canReshare,
        });
      }
    },
    onSettled: () => invalidateSharing(queryClient, user.id),
  });
}

export function useShareRemove() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { shareId: string; on: ShareItem["kind"]; target: ShareTarget }) => {
      const { error } = await createClient().rpc("note_share_remove", { _share: input.shareId });
      if (error) throw error;
      track("note_share_removed", { on: input.on, target: input.target });
    },
    onSettled: () => invalidateSharing(queryClient, user.id),
  });
}

/** "Private in this folder" of a note in a shared folder (the owner only). */
export function useSetFolderPrivate() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, value }: { noteId: string; value: boolean }) => {
      const { error } = await createClient()
        .from("notes")
        .update({ folder_private: value })
        .eq("id", noteId)
        .eq("user_id", user.id);
      if (error) throw error;
      track("note_folder_private_set", { private: value });
    },
    onMutate: ({ noteId, value }) => {
      queryClient.setQueryData<NoteDetail | null>(noteKeys.detail(user.id, noteId), (old) =>
        old ? { ...old, folder_private: value } : old,
      );
    },
    onSettled: () => invalidateSharing(queryClient, user.id),
  });
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export function useCreateFolder() {
  const { user } = useSession();
  const { id: space } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; color: FolderColor; parentId: string | null; position: number }) => {
      const id = crypto.randomUUID();
      const { error } = await createClient().from("note_folders").insert({
        id,
        space_id: space,
        name: input.name,
        color: input.color,
        parent_id: input.parentId,
        position: input.position,
      });
      if (error) throw error;
      track("note_folder_created", { nested: !!input.parentId });
      return id;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: sharingKeys.folders(user.id, space) }),
  });
}

export function useUpdateFolder() {
  const { user } = useSession();
  const { id: space } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name: string;
      color: FolderColor;
      parentId: string | null;
      changed: Array<"name" | "color" | "parent">;
    }) => {
      const { error } = await createClient()
        .from("note_folders")
        .update({ name: input.name, color: input.color, parent_id: input.parentId })
        .eq("id", input.id);
      if (error) throw error;
      for (const field of input.changed) track("note_folder_updated", { field });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: sharingKeys.folders(user.id, space) }),
  });
}

/** Deletes a folder (and its subfolders); its notes stay, out of any folder. */
export function useDeleteFolder() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: number }) => {
      const { error } = await createClient().from("note_folders").delete().eq("id", id);
      if (error) throw error;
      track("note_folder_deleted", { notes: Math.min(notes, 5000) });
    },
    onSettled: () => invalidateSharing(queryClient, user.id),
  });
}

/** Puts one of the account's notes into a folder (null = out of every folder). */
export function useMoveNote() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { noteId: string; folderId: string | null; via: "drag" | "menu" }) => {
      const { error } = await createClient()
        .from("notes")
        .update({ folder_id: input.folderId })
        .eq("id", input.noteId)
        .eq("user_id", user.id);
      if (error) throw error;
      track("note_moved", { to: input.folderId ? "folder" : "none", via: input.via });
    },
    onMutate: ({ noteId, folderId }) => {
      const key = noteKeys.list(user.id);
      const previous = queryClient.getQueryData<NoteListItem[]>(key);
      queryClient.setQueryData<NoteListItem[]>(key, (list) =>
        list?.map((note) => (note.id === noteId ? { ...note, folder_id: folderId } : note)),
      );
      queryClient.setQueryData<NoteDetail | null>(noteKeys.detail(user.id, noteId), (old) =>
        old ? { ...old, folder_id: folderId } : old,
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(noteKeys.list(user.id), context.previous);
    },
    onSettled: () => invalidateSharing(queryClient, user.id),
  });
}

/** "Remove from mine": a note someone shares leaves the account's lists. */
export function useDismissNote() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: string) => {
      const { error } = await createClient().from("note_dismissals").insert({ note_id: noteId });
      if (error && error.code !== "23505") throw error;
      track("note_dismissed", {});
    },
    onMutate: (noteId) => {
      queryClient.setQueryData<NoteListItem[]>(noteKeys.list(user.id), (list) =>
        list?.filter((note) => note.id !== noteId),
      );
    },
    onSettled: () => invalidateSharing(queryClient, user.id),
  });
}
