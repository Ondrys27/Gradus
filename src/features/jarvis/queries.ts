"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import { createClient } from "@/lib/supabase/client";
import { readChatStream } from "./chat-stream";
import type { ChatEvent, ChatRequest, JarvisOverview } from "./protocol";

const ENDPOINT = "/api/jarvis";

/** Messages shown when the panel opens; older ones stay in the database. */
export const VISIBLE_MESSAGES = 50;

export const jarvisKeys = {
  conversation: (userId: string) => ["jarvis", userId, "conversation"] as const,
  overview: (userId: string) => ["jarvis", userId, "overview"] as const,
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type Conversation = { id: string | null; messages: ChatMessage[] };

/**
 * The latest conversation and its last messages. Read once per session; the
 * panel keeps the cache up to date as messages stream in.
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
      return { id: conversation.id, messages: data.reverse() };
    },
  });
}

/** Calls left this month and the chips for the situation; read each time the panel opens. */
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
