"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { createClient } from "@/lib/supabase/client";
import { readChatStream } from "./chat-stream";
import { uploadContentType, type FileKind, MIME_BY_KIND } from "./files";
import type {
  AttachmentRef,
  ChatAttachment,
  ChatErrorCode,
  ChatEvent,
  ChatRequest,
  JarvisOverview,
  PingResult,
} from "./protocol";
import type { Suggestion, SuggestionsResponse } from "./suggestions";
import { track } from "@/lib/analytics/client";

const ENDPOINT = "/api/jarvis";
const ATTACHMENTS_BUCKET = "attachments";
const MESSAGE_ENTITY = "jarvis_message";

/** Messages shown when the panel opens; older ones stay in the database. */
export const VISIBLE_MESSAGES = 50;
/** How often open suggestions are looked at again while the app is open. */
const SUGGESTIONS_INTERVAL = 15 * 60_000;

export const jarvisKeys = {
  conversation: (userId: string) => ["jarvis", userId, "conversation"] as const,
  overview: (userId: string) => ["jarvis", userId, "overview"] as const,
  suggestions: (userId: string) => ["jarvis", userId, "suggestions"] as const,
  salesAnalysis: (userId: string) => ["jarvis", userId, "sales-analysis"] as const,
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
};

export type Conversation = { id: string | null; messages: ChatMessage[] };

const KIND_BY_MIME = new Map(
  Object.entries(MIME_BY_KIND).map(([kind, mime]) => [mime, kind as FileKind]),
);

/**
 * The latest conversation and its last messages with their files. Read once
 * per session; the panel keeps the cache up to date as messages stream in.
 */
export function useJarvisConversation(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: jarvisKeys.conversation(user.id),
    enabled,
    staleTime: Infinity,
    queryFn: async (): Promise<Conversation> => {
      const supabase = createClient();
      const { data: conversation, error } = await supabase
        .from("jarvis_conversations")
        .select("id")
        .is("archived_at", null)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!conversation) return { id: null, messages: [] };

      const { data, error: messagesError } = await supabase
        .from("jarvis_messages")
        .select("id, role, content")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: false })
        .limit(VISIBLE_MESSAGES);
      if (messagesError) throw messagesError;

      const userIds = data.filter((m) => m.role === "user").map((m) => m.id);
      const files = new Map<string, ChatAttachment[]>();
      if (userIds.length) {
        const { data: rows, error: filesError } = await supabase
          .from("attachments")
          .select("id, entity_id, file_name, mime_type")
          .eq("entity_type", MESSAGE_ENTITY)
          .in("entity_id", userIds)
          .order("created_at")
          .limit(userIds.length * 3);
        if (filesError) throw filesError;
        for (const row of rows) {
          const list = files.get(row.entity_id) ?? [];
          list.push({
            id: row.id,
            name: row.file_name,
            kind: KIND_BY_MIME.get(row.mime_type) ?? "txt",
          });
          files.set(row.entity_id, list);
        }
      }
      return {
        id: conversation.id,
        messages: data.reverse().map((message) => ({
          ...message,
          attachments: files.get(message.id),
        })),
      };
    },
  });
}

/** Calls and files left this month and the chips for the situation; read each time the panel opens. */
export function useJarvisOverview(enabled: boolean) {
  const { user } = useSession();
  return useQuery({
    queryKey: jarvisKeys.overview(user.id),
    enabled,
    staleTime: 0,
    queryFn: async (): Promise<JarvisOverview> => {
      const response = await fetch(ENDPOINT, { cache: "no-store" });
      if (!response.ok) throw new Error(`jarvis overview ${response.status}`);
      return response.json();
    },
  });
}

/**
 * Uploads a file to the user's own folder (storage rules allow nothing else).
 * The server checks it by content before the message uses it.
 */
export async function uploadChatFile(userId: string, file: File): Promise<AttachmentRef> {
  const contentType = uploadContentType(file.name);
  if (!contentType) throw new Error("fileType");
  const path = `${userId}/jarvis/${crypto.randomUUID()}`;
  const { error } = await createClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (error) throw error;
  return { path, name: file.name };
}

/** Removes uploads that were never sent (the message failed before the server took them). */
export async function removeChatFiles(paths: string[]) {
  if (!paths.length) return;
  await createClient().storage.from(ATTACHMENTS_BUCKET).remove(paths);
}

/**
 * Sends one message and reports every line of the answer. Resolves with the
 * last event: done, or an error (refusals before streaming arrive as one event).
 */
export async function sendChat(
  request: ChatRequest,
  onEvent: (event: ChatEvent) => void,
): Promise<ChatEvent> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    const event: ChatEvent = { type: "error", code: "network" };
    onEvent(event);
    return event;
  }
  return readChatStream(response, onEvent);
}

export type JobError = ChatErrorCode | "locked" | "alreadyReviewed" | "empty";

/** One of the other jobs of /api/jarvis (milestone review, sales analysis). */
export async function postJarvisJob<T>(
  body: Record<string, unknown>,
): Promise<({ ok: true } & T) | { ok: false; code: JobError }> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as
      ({ ok: true } & T) | { ok: false; code: JobError } | null;
    return json ?? { ok: false, code: "unknown" };
  } catch {
    return { ok: false, code: "network" };
  }
}

/**
 * Settings → Integrations: one short question to /api/jarvis. Never throws; a
 * refused or broken answer comes back as a code the settings can show.
 */
export function usePingJarvis() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<PingResult> => {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "ping" }),
        });
      } catch {
        return { ok: false, code: "network", durationMs: null };
      }
      const body = (await response.json().catch(() => null)) as PingResult | null;
      return body && typeof body.ok === "boolean"
        ? body
        : { ok: false, code: "unknown", durationMs: null };
    },
    // A successful test uses one call of the month; the panel's counter follows.
    onSettled: () => queryClient.invalidateQueries({ queryKey: jarvisKeys.overview(user.id) }),
  });
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/**
 * What Jarvis noticed. Asking the server also runs the instant triggers, so
 * a won deal or a follow-up due today shows without waiting for the watch.
 */
export function useJarvisSuggestions() {
  const { user } = useSession();
  return useQuery({
    queryKey: jarvisKeys.suggestions(user.id),
    staleTime: 60_000,
    refetchInterval: SUGGESTIONS_INTERVAL,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Suggestion[]> => {
      const response = await fetch(`${ENDPOINT}?view=suggestions`, { cache: "no-store" });
      if (!response.ok) throw new Error(`jarvis suggestions ${response.status}`);
      return ((await response.json()) as SuggestionsResponse).suggestions;
    },
  });
}

/** The client may only stamp seen_at and dismissed_at (database guard). */
function useStampSuggestions(column: "seen_at" | "dismissed_at") {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = jarvisKeys.suggestions(user.id);
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await createClient()
        .from("jarvis_suggestions")
        .update(
          column === "seen_at"
            ? { seen_at: new Date().toISOString() }
            : { dismissed_at: new Date().toISOString() },
        )
        .in("id", ids);
      if (error) throw error;
    },
    onMutate: (ids) => {
      const previous = queryClient.getQueryData<Suggestion[]>(key);
      queryClient.setQueryData<Suggestion[]>(key, (list) =>
        column === "seen_at"
          ? list?.map((s) => (ids.includes(s.id) ? { ...s, seen: true } : s))
          : list?.filter((s) => !ids.includes(s.id)),
      );
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
  });
}

export function useMarkSuggestionsSeen() {
  return useStampSuggestions("seen_at");
}

export function useDismissSuggestion() {
  return useStampSuggestions("dismissed_at");
}

/** Takes back a task Jarvis marked done: the user's own change, through RLS. */
export function useUndoTaskCompletion() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { taskId: string; previousStatus: "todo" | "in_progress" }) => {
      const { error } = await createClient()
        .from("tasks")
        .update({ status: input.previousStatus })
        .eq("user_id", workspaceId)
        .eq("id", input.taskId);
      if (error) throw error;
      track("jarvis_auto_action_undone", { action: "task_completed" });
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["milestones", user.id] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", user.id] }),
      ]),
  });
}

// ---------------------------------------------------------------------------
// Sales analysis
// ---------------------------------------------------------------------------

export type SalesAnalysis = { id: string; content: string; created_at: string };

export type SalesAnalysisState = { surveys: number; latest: SalesAnalysis | null };

/** How many surveys there are and the latest analysis. */
export function useSalesAnalysis(enabled: boolean) {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: jarvisKeys.salesAnalysis(user.id),
    enabled,
    queryFn: async (): Promise<SalesAnalysisState> => {
      const supabase = createClient();
      const [surveys, latest] = await Promise.all([
        supabase
          .from("meeting_surveys")
          .select("id", { count: "exact", head: true })
          .eq("user_id", workspaceId),
        supabase
          .from("sales_analyses")
          .select("id, content, created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (surveys.error) throw surveys.error;
      if (latest.error) throw latest.error;
      return { surveys: surveys.count ?? 0, latest: latest.data };
    },
  });
}

export class JarvisJobError extends Error {
  constructor(readonly code: JobError) {
    super(code);
  }
}

export function useRunSalesAnalysis() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const key = jarvisKeys.salesAnalysis(user.id);
  return useMutation({
    mutationKey: ["jarvis", "sales-analysis"],
    mutationFn: async () => {
      const result = await postJarvisJob<{ analysis: SalesAnalysis }>({ kind: "salesAnalysis" });
      track("sales_analysis_requested", { ok: result.ok });
      if (!result.ok) throw new JarvisJobError(result.code);
      return result.analysis;
    },
    onSuccess: (analysis) => {
      queryClient.setQueryData<SalesAnalysisState>(key, (state) =>
        state ? { ...state, latest: analysis } : state,
      );
      void queryClient.invalidateQueries({ queryKey: jarvisKeys.overview(user.id) });
    },
  });
}
