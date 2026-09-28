"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import type { AiCallUsage, ChatErrorCode, JarvisOverview } from "./protocol";
import {
  jarvisKeys,
  sendChat,
  VISIBLE_MESSAGES,
  type ChatMessage,
  type Conversation,
} from "./queries";

/** The turn in flight: the user's text until the server saves it, then the streamed answer. */
export type PendingTurn = {
  /** Shown until the server confirms the message; null once it sits in the conversation. */
  userText: string | null;
  answer: string;
};

export type ChatError = { code: ChatErrorCode; usage?: AiCallUsage };

function append(conversation: Conversation, message: ChatMessage): Conversation {
  if (conversation.messages.some((item) => item.id === message.id)) return conversation;
  return {
    ...conversation,
    messages: [...conversation.messages, message].slice(-VISIBLE_MESSAGES),
  };
}

/**
 * Sends messages to Jarvis and keeps the cached conversation in step with the
 * stream. Only one turn runs at a time.
 */
export function useJarvisChat() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const conversationKey = jarvisKeys.conversation(user.id);
  const overviewKey = jarvisKeys.overview(user.id);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [error, setError] = useState<ChatError | null>(null);
  const busy = useRef(false);

  const updateConversation = useCallback(
    (update: (conversation: Conversation) => Conversation) =>
      queryClient.setQueryData<Conversation>(conversationKey, (current) =>
        update(current ?? { id: null, messages: [] }),
      ),
    [queryClient, conversationKey],
  );

  const updateUsage = useCallback(
    (usage: AiCallUsage | undefined) => {
      if (!usage) return;
      queryClient.setQueryData<JarvisOverview>(overviewKey, (current) =>
        current ? { ...current, usage } : current,
      );
    },
    [queryClient, overviewKey],
  );

  /** Resolves true when the message reached the server (the input can be cleared). */
  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const message = text.trim();
      if (!message || busy.current) return false;
      busy.current = true;
      setError(null);
      setPending({ userText: message, answer: "" });

      const conversation = queryClient.getQueryData<Conversation>(conversationKey);
      let accepted = false;
      let answer = "";
      const last = await sendChat(
        { conversationId: conversation?.id ?? null, message },
        (event) => {
          switch (event.type) {
            case "start":
              accepted = true;
              updateConversation((current) =>
                append(
                  { ...current, id: event.conversationId },
                  { id: event.userMessageId, role: "user", content: message },
                ),
              );
              setPending({ userText: null, answer: "" });
              break;
            case "delta":
              answer += event.text;
              setPending({ userText: null, answer });
              break;
            case "done":
              updateConversation((current) =>
                append(current, { id: event.messageId, role: "assistant", content: answer }),
              );
              // The answer now sits in the conversation; drop the streaming copy in the same render.
              setPending(null);
              updateUsage(event.usage);
              break;
            case "error":
              updateUsage(event.usage);
              break;
          }
        },
      );

      if (last.type === "error") {
        setError({ code: last.code, usage: last.usage });
        // A conversation that no longer exists: start a fresh one next time.
        if (last.code === "notFound") updateConversation(() => ({ id: null, messages: [] }));
      }
      setPending(null);
      busy.current = false;
      return accepted;
    },
    [queryClient, conversationKey, updateConversation, updateUsage],
  );

  /** Starts a new conversation; the old one stays in the database. */
  const reset = useCallback(() => {
    if (busy.current) return;
    setError(null);
    queryClient.setQueryData<Conversation>(conversationKey, { id: null, messages: [] });
  }, [queryClient, conversationKey]);

  const dismissError = useCallback(() => setError(null), []);

  return { send, reset, pending, error, dismissError };
}
