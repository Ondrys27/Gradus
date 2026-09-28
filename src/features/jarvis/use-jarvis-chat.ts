"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/queries";
import type { AiCallUsage, AttachmentRef, ChatErrorCode, JarvisOverview } from "./protocol";
import {
  jarvisKeys,
  removeChatFiles,
  sendChat,
  uploadChatFile,
  VISIBLE_MESSAGES,
  type ChatMessage,
  type Conversation,
} from "./queries";

/** The turn in flight: the user's text until the server saves it, then the streamed answer. */
export type PendingTurn = {
  /** Shown until the server confirms the message; null once it sits in the conversation. */
  userText: string | null;
  /** Names of the files going with it, shown the same way. */
  fileNames: string[];
  answer: string;
};

/** "fileUpload" and "tooManyFiles" come from the panel itself, before anything is sent. */
export type ChatError = {
  code: ChatErrorCode | "fileUpload" | "tooManyFiles";
  usage?: AiCallUsage;
};

export type SendResult = "accepted" | "refused" | "filesRefused";

/** Whether the files were refused, so the panel drops them instead of offering them again. */
export function isFileError(code: ChatError["code"]): boolean {
  return code.startsWith("file");
}

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

  /**
   * Uploads the files to the user's folder, then sends the message with them.
   * Resolves "accepted" when the message reached the server (the input can be
   * cleared), "filesRefused" when the server refused the files (drop them) and
   * "refused" otherwise (keep text and files for another try).
   */
  const send = useCallback(
    async (text: string, files: File[] = []): Promise<SendResult> => {
      const message = text.trim();
      if ((!message && !files.length) || busy.current) return "refused";
      busy.current = true;
      setError(null);
      const fileNames = files.map((file) => file.name);
      setPending({ userText: message, fileNames, answer: "" });

      let attachments: AttachmentRef[] = [];
      try {
        attachments = await Promise.all(files.map((file) => uploadChatFile(user.id, file)));
      } catch {
        setError({ code: "fileUpload" });
        setPending(null);
        busy.current = false;
        return "refused";
      }

      const conversation = queryClient.getQueryData<Conversation>(conversationKey);
      let accepted = false;
      let answer = "";
      const last = await sendChat(
        { conversationId: conversation?.id ?? null, message, attachments },
        (event) => {
          switch (event.type) {
            case "start":
              accepted = true;
              updateConversation((current) =>
                append(
                  { ...current, id: event.conversationId },
                  {
                    id: event.userMessageId,
                    role: "user",
                    content: message,
                    attachments: event.attachments,
                  },
                ),
              );
              setPending({ userText: null, fileNames: [], answer: "" });
              if (event.attachments.length) {
                void queryClient.invalidateQueries({ queryKey: overviewKey });
              }
              break;
            case "delta":
              answer += event.text;
              setPending({ userText: null, fileNames: [], answer });
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

      // Uploads the server never took (connection lost, limit) are not left behind.
      if (!accepted && last.type === "error" && !isFileError(last.code)) {
        void removeChatFiles(attachments.map((ref) => ref.path)).catch(() => undefined);
      }
      if (last.type === "error") {
        setError({ code: last.code, usage: last.usage });
        // A conversation that no longer exists: start a fresh one next time.
        if (last.code === "notFound") updateConversation(() => ({ id: null, messages: [] }));
      }
      setPending(null);
      busy.current = false;
      if (accepted) return "accepted";
      return last.type === "error" && isFileError(last.code) ? "filesRefused" : "refused";
    },
    [queryClient, conversationKey, overviewKey, updateConversation, updateUsage, user.id],
  );

  /** Starts a new conversation; the old one stays in the database. */
  const reset = useCallback(() => {
    if (busy.current) return;
    setError(null);
    queryClient.setQueryData<Conversation>(conversationKey, { id: null, messages: [] });
  }, [queryClient, conversationKey]);

  const dismissError = useCallback(() => setError(null), []);
  /** For problems the panel finds itself (a file too large, too many files). */
  const showError = useCallback((next: ChatError) => setError(next), []);

  return { send, reset, pending, error, dismissError, showError };
}
