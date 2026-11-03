"use client";

import { useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import { unreadTotal } from "./logic";
import {
  CHAT_MESSAGE_COLUMNS,
  CHAT_PAGE_SIZE,
  type ChatAttachment,
  type ChatChannel,
  type ChatKind,
  type ChatMemberRead,
  type ChatMessage,
  type ChatPerson,
} from "./types";

/**
 * Reading and writing Messages with the signed-in user's client: the policies
 * of the chat tables decide everything (only members read, the database
 * stamps the sender). Sending goes through /api/chat/messages (see outbox).
 */

export const chatKeys = {
  all: (userId: string) => ["chat", userId] as const,
  overview: (userId: string, space: string) => ["chat", userId, space, "overview"] as const,
  people: (userId: string, space: string) => ["chat", userId, space, "people"] as const,
  messages: (userId: string, channel: string) => ["chat", userId, "messages", channel] as const,
  members: (userId: string, channel: string) => ["chat", userId, "members", channel] as const,
  message: (userId: string, id: string) => ["chat", userId, "message", id] as const,
  records: (userId: string, space: string, set: string) =>
    ["chat", userId, space, "records", set] as const,
  trashed: (userId: string, set: string) => ["chat", userId, "trashed", set] as const,
};

/** The signed-in account's member token in its space: the owner's id or the worker's id. */
export function useChatMe(): { me: string; space: string; isOwner: boolean; readOnly: boolean } {
  const workspace = useWorkspace();
  const isOwner = workspace.role === "owner";
  return {
    me: isOwner ? workspace.id : (workspace.workerId ?? workspace.userId),
    space: workspace.id,
    isOwner,
    readOnly: workspace.readOnly,
  };
}

type OverviewRow = {
  id: string;
  kind: string;
  name: string | null;
  color: string | null;
  group_id: string | null;
  archived: boolean;
  muted_all: boolean;
  muted: boolean;
  pinned_at: string | null;
  last_read_at: string | null;
  peer: string | null;
  member_count: number;
  created_at: string;
  last_id: string | null;
  last_sender: string | null;
  last_body: string | null;
  last_attachments: number | null;
  last_deleted: boolean | null;
  last_at: string | null;
  unread: number;
  mentioned: boolean;
};

export function toChannel(row: OverviewRow): ChatChannel {
  return {
    id: row.id,
    kind: row.kind === "direct" ? "direct" : "group",
    name: row.name,
    color: row.color,
    groupId: row.group_id,
    archived: row.archived,
    mutedAll: row.muted_all,
    muted: row.muted,
    pinnedAt: row.pinned_at,
    lastReadAt: row.last_read_at,
    peer: row.peer,
    memberCount: row.member_count,
    createdAt: row.created_at,
    last: row.last_id
      ? {
          id: row.last_id,
          sender: row.last_sender,
          body: row.last_body ?? "",
          attachments: row.last_attachments ?? 0,
          deleted: Boolean(row.last_deleted),
          at: row.last_at!,
        }
      : null,
    unread: row.unread,
    mentioned: row.mentioned,
  };
}

/** The conversations of the account: one call, read again whenever something arrives. */
export function useChatOverview() {
  const { user } = useSession();
  const { space } = useChatMe();
  return useQuery({
    queryKey: chatKeys.overview(user.id, space),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("chat_overview");
      if (error) throw error;
      return ((data ?? []) as OverviewRow[]).map(toChannel);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** What the menu badge and the tab title show. */
export function useChatUnread(): number {
  const overview = useChatOverview();
  return useMemo(() => unreadTotal(overview.data ?? []), [overview.data]);
}

/** Everybody of the space one may write to, and whose names the messages show. */
export function useChatPeople() {
  const { user } = useSession();
  const { space } = useChatMe();
  return useQuery({
    queryKey: chatKeys.people(user.id, space),
    queryFn: async (): Promise<ChatPerson[]> => {
      const { data, error } = await createClient().rpc("chat_people");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        member: row.member,
        isOwner: row.is_owner,
        name: row.name,
        avatarUrl: row.avatar_url,
        jobTitle: row.job_title,
        status: row.status,
        hasAccount: row.has_account,
      }));
    },
    staleTime: 60_000,
  });
}

type Page = { messages: ChatMessage[]; older: { at: string; id: string } | null };

function normalize(row: unknown): ChatMessage {
  const message = row as ChatMessage;
  return { ...message, attachments: Array.isArray(message.attachments) ? message.attachments : [] };
}

/** One conversation, 50 messages at a time from the newest; older pages load upwards. */
export function useChannelMessages(channelId: string | null) {
  const { user } = useSession();
  return useInfiniteQuery({
    queryKey: chatKeys.messages(user.id, channelId ?? ""),
    enabled: Boolean(channelId),
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: async ({ pageParam }): Promise<Page> => {
      let query = createClient()
        .from("chat_messages")
        .select(CHAT_MESSAGE_COLUMNS)
        .eq("channel_id", channelId!)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(CHAT_PAGE_SIZE);
      if (pageParam) {
        query = query.or(
          `created_at.lt."${pageParam.at}",and(created_at.eq."${pageParam.at}",id.lt.${pageParam.id})`,
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      const messages = (data ?? []).map(normalize);
      const oldest = messages[messages.length - 1];
      return {
        messages,
        older: messages.length === CHAT_PAGE_SIZE && oldest ? { at: oldest.created_at, id: oldest.id } : null,
      };
    },
    getNextPageParam: (last) => last.older,
    staleTime: 60_000,
  });
}

/** Everything loaded of a conversation, oldest first. */
export function flattenPages(data: InfiniteData<Page> | undefined): ChatMessage[] {
  if (!data) return [];
  const out: ChatMessage[] = [];
  for (let index = data.pages.length - 1; index >= 0; index -= 1) {
    out.push(...[...data.pages[index]!.messages].reverse());
  }
  return out;
}

/** A message arrived or changed: into the loaded pages, once. */
export function upsertMessage(client: QueryClient, userId: string, message: ChatMessage) {
  const key = chatKeys.messages(userId, message.channel_id);
  client.setQueryData<InfiniteData<Page>>(key, (data) => {
    if (!data) return data;
    let found = false;
    const pages = data.pages.map((page) => ({
      ...page,
      messages: page.messages.map((known) => {
        if (known.id !== message.id) return known;
        found = true;
        return normalize(message);
      }),
    }));
    if (!found && pages[0]) {
      pages[0] = { ...pages[0], messages: [normalize(message), ...pages[0].messages] };
    }
    return { ...data, pages };
  });
  client.setQueryData(chatKeys.message(userId, message.id), normalize(message));
}

/** Who of the conversation read up to when (the read receipts). */
export function useChannelMembers(channelId: string | null) {
  const { user } = useSession();
  return useQuery({
    queryKey: chatKeys.members(user.id, channelId ?? ""),
    enabled: Boolean(channelId),
    queryFn: async (): Promise<ChatMemberRead[]> => {
      const { data, error } = await createClient()
        .from("chat_members")
        .select("member, last_read_at")
        .eq("channel_id", channelId!)
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((row) => ({ member: row.member!, last_read_at: row.last_read_at }));
    },
    staleTime: 30_000,
  });
}

/** A message quoted by a reply that is not among the loaded ones. */
export function useChatMessage(id: string | null, loaded: ChatMessage | undefined) {
  const { user } = useSession();
  return useQuery({
    queryKey: chatKeys.message(user.id, id ?? ""),
    enabled: Boolean(id) && !loaded,
    initialData: loaded,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("chat_messages")
        .select(CHAT_MESSAGE_COLUMNS)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data ? normalize(data) : null;
    },
    staleTime: 60_000,
  });
}

/** Which of these files the yearly cleanup moved to the trash. */
export function useTrashedFiles(files: readonly ChatAttachment[]) {
  const { user } = useSession();
  const paths = files.map((file) => file.path).sort();
  return useQuery({
    queryKey: chatKeys.trashed(user.id, paths.join(",")),
    enabled: paths.length > 0,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("chat_trashed_files", { _paths: paths });
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.path));
    },
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

function patchOverview(
  client: QueryClient,
  userId: string,
  space: string,
  id: string,
  patch: Partial<ChatChannel>,
) {
  client.setQueryData<ChatChannel[]>(chatKeys.overview(userId, space), (list) =>
    list?.map((channel) => (channel.id === id ? { ...channel, ...patch } : channel)),
  );
}

/** Read up to the newest message the reader saw; the list clears the count at once. */
export function useMarkRead() {
  const { user } = useSession();
  const { space } = useChatMe();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ channelId, until }: { channelId: string; until: string }) => {
      const { data, error } = await createClient().rpc("chat_mark_read", {
        _channel: channelId,
        _until: until,
      });
      if (error) throw error;
      return data as string;
    },
    onMutate: ({ channelId, until }) => {
      patchOverview(client, user.id, space, channelId, { unread: 0, mentioned: false, lastReadAt: until });
    },
    onSettled: (_data, _error, { channelId }) => {
      void client.invalidateQueries({ queryKey: chatKeys.overview(user.id, space) });
      void client.invalidateQueries({ queryKey: chatKeys.members(user.id, channelId) });
    },
  });
}

/** Own pin and mute of a conversation. */
export function useMemberFlags() {
  const { user } = useSession();
  const { space } = useChatMe();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { channelId: string; pinned?: boolean; muted?: boolean }) => {
      const { error } = await createClient().rpc("chat_set_member_flags", {
        _channel: input.channelId,
        _pinned: input.pinned,
        _muted: input.muted,
      });
      if (error) throw error;
    },
    onMutate: (input) => {
      patchOverview(client, user.id, space, input.channelId, {
        ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? new Date().toISOString() : null } : {}),
        ...(input.muted !== undefined ? { muted: input.muted } : {}),
      });
      if (input.muted !== undefined) {
        track("chat_conversation_muted", { muted: input.muted, scope: "me" });
      }
    },
    onSettled: () => void client.invalidateQueries({ queryKey: chatKeys.overview(user.id, space) }),
  });
}

/** The owner silences a group conversation for everyone. */
export function useMuteAll() {
  const { user } = useSession();
  const { space } = useChatMe();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ channelId, muted }: { channelId: string; muted: boolean }) => {
      const { error } = await createClient().rpc("chat_set_muted_all", {
        _channel: channelId,
        _muted: muted,
      });
      if (error) throw error;
    },
    onMutate: ({ channelId, muted }) => {
      patchOverview(client, user.id, space, channelId, { mutedAll: muted });
      track("chat_conversation_muted", { muted, scope: "all" });
    },
    onSettled: () => void client.invalidateQueries({ queryKey: chatKeys.overview(user.id, space) }),
  });
}

/** Edits the text of an own message (the database allows it for 15 minutes). */
export function useEditMessage(kind: ChatKind) {
  const { user } = useSession();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ message, body }: { message: ChatMessage; body: string }) => {
      const { data, error } = await createClient()
        .from("chat_messages")
        .update({ body })
        .eq("id", message.id)
        .select(CHAT_MESSAGE_COLUMNS)
        .single();
      if (error) throw error;
      return normalize(data);
    },
    onMutate: ({ message, body }) => {
      upsertMessage(client, user.id, { ...message, body, edited_at: new Date().toISOString() });
    },
    onSuccess: (message) => {
      upsertMessage(client, user.id, message);
      track("chat_message_edited", { kind });
    },
    onError: (_error, { message }) => upsertMessage(client, user.id, message),
  });
}

/** Deletes a message: own within 15 minutes, anybody's for the owner of the space. */
export function useDeleteMessage(kind: ChatKind) {
  const { user } = useSession();
  const { me } = useChatMe();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (message: ChatMessage) => {
      const { data, error } = await createClient()
        .from("chat_messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", message.id)
        .select(CHAT_MESSAGE_COLUMNS)
        .single();
      if (error) throw error;
      return normalize(data);
    },
    onMutate: (message) => {
      upsertMessage(client, user.id, {
        ...message,
        body: "",
        attachments: [],
        deleted_at: new Date().toISOString(),
      });
    },
    onSuccess: (deleted, message) => {
      upsertMessage(client, user.id, deleted);
      track("chat_message_deleted", { kind, by: message.sender === me ? "sender" : "owner" });
    },
    onError: (_error, message) => upsertMessage(client, user.id, message),
  });
}
