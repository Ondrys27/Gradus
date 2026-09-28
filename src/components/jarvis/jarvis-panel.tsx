"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowUpIcon, SquarePenIcon, XIcon } from "lucide-react";
import { JarvisBot } from "@/components/jarvis/jarvis-bot";
import { MAX_MESSAGE_LENGTH, type SuggestionKey } from "@/features/jarvis/protocol";
import { useJarvisConversation, useJarvisOverview } from "@/features/jarvis/queries";
import type { useJarvisChat } from "@/features/jarvis/use-jarvis-chat";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

type JarvisPanelProps = {
  chat: ReturnType<typeof useJarvisChat>;
  onClose: () => void;
};

/**
 * The chat panel: 420 × 620 px above the button on larger screens, the whole
 * screen on phones. Answers stream in as they are written.
 */
export function JarvisPanel({ chat, onClose }: JarvisPanelProps) {
  const t = useTranslations("jarvis");
  const settings = useFormatSettings();
  const reduceMotion = useReducedMotion();
  const isPhone = useIsPhone();
  const conversation = useJarvisConversation(true);
  const overview = useJarvisOverview(true);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { pending, error } = chat;
  const messages = conversation.data?.messages ?? [];
  const usage = overview.data?.usage;
  const suggestions = overview.data?.suggestions ?? [];
  const busy = pending !== null;

  // Escape closes; focus goes to the input on larger screens (on phones it would pop the keyboard).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!isPhone) inputRef.current?.focus();
  }, [isPhone]);

  // Keep the newest line in view while the answer streams.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, pending?.answer, pending?.userText, error]);

  // The input grows with the text, up to about five lines.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  }, [draft]);

  const submit = async (text: string) => {
    if (busy || !text.trim()) return;
    setDraft("");
    const accepted = await chat.send(text);
    // Refused before it was saved (limit, connection): the text comes back to the input.
    if (!accepted) setDraft((current) => current || text);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(draft);
  };

  const onInputKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit(draft);
    }
  };

  const errorText = error
    ? error.code === "limitReached"
      ? t("error.limitReached", {
          limit: formatNumber(error.usage?.limit ?? usage?.limit ?? 0, {}, settings),
        })
      : t(`error.${error.code}`)
    : null;

  const showTyping = pending !== null && !pending.answer;
  const showChips = !busy && suggestions.length > 0;

  return (
    <motion.section
      role="dialog"
      aria-modal={isPhone}
      aria-label={t("title")}
      initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
      style={{ transformOrigin: "bottom right" }}
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden bg-surface",
        // Phone: the whole screen, clear of the notch and the home indicator.
        "inset-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        // Larger screens: 420 × 620 above the button, never taller than the window.
        "md:inset-auto md:right-6 md:bottom-[calc(24px+64px+16px)] md:h-[min(620px,calc(100dvh-24px-64px-16px-24px))] md:w-[420px] md:rounded-3xl md:border md:border-line-strong md:pt-0 md:pb-0 md:shadow-popover",
      )}
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-2">
        <JarvisBot size={36} state={busy ? "thinking" : "idle"} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">{t("title")}</h2>
          <p className="truncate text-xs text-ink-muted">
            {usage
              ? t("usage", {
                  used: formatNumber(usage.used, {}, settings),
                  limit: formatNumber(usage.limit, {}, settings),
                })
              : t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={chat.reset}
          disabled={busy || messages.length === 0}
          aria-label={t("newChat")}
          title={t("newChat")}
          className="grid size-11 place-items-center rounded-full text-ink-soft outline-none transition-colors hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-teal/50 disabled:opacity-40"
        >
          <SquarePenIcon aria-hidden className="size-5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="-mr-2 grid size-11 place-items-center rounded-full text-ink-soft outline-none transition-colors hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-teal/50"
        >
          <XIcon aria-hidden className="size-5" />
        </button>
      </header>

      <div
        ref={listRef}
        aria-live="polite"
        aria-busy={busy}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {messages.length === 0 && !pending && <AssistantBubble text={t("greeting")} />}
        {conversation.isError && messages.length === 0 && (
          <p className="text-xs text-ink-muted">{t("loadFailed")}</p>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <UserBubble key={message.id} text={message.content} />
          ) : (
            <AssistantBubble key={message.id} text={message.content} />
          ),
        )}
        {pending?.userText && <UserBubble text={pending.userText} />}
        {pending?.answer && <AssistantBubble text={pending.answer} />}
        {showTyping && <TypingDots label={t("typing")} />}
        {errorText && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-2xl border border-pink/40 bg-pink/10 px-3.5 py-2.5 text-sm text-ink"
          >
            <p className="flex-1">{errorText}</p>
            <button
              type="button"
              onClick={chat.dismissError}
              aria-label={t("error.dismiss")}
              className="-my-2 -mr-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-soft outline-none focus-visible:ring-3 focus-visible:ring-pink/50"
            >
              <XIcon aria-hidden className="size-4" />
            </button>
          </div>
        )}
      </div>

      {showChips && (
        <div aria-label={t("suggestions")} role="group" className="flex flex-wrap gap-2 px-4 pb-2">
          {suggestions.map((key: SuggestionKey) => (
            <button
              key={key}
              type="button"
              onClick={() => void submit(t(`chip.${key}`))}
              className="min-h-11 rounded-full border border-teal/40 bg-teal/10 px-3.5 text-left text-sm text-ink outline-none transition-colors hover:bg-teal/20 focus-visible:ring-3 focus-visible:ring-teal/50 mouse:min-h-9"
            >
              {t(`chip.${key}`)}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line px-3 py-3">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onInputKey}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          aria-label={t("inputLabel")}
          placeholder={t("placeholder")}
          className="min-h-11 flex-1 resize-none rounded-2xl border border-line bg-canvas px-3.5 py-2.5 text-base text-ink outline-none placeholder:text-ink-muted focus-visible:border-teal/60 focus-visible:ring-3 focus-visible:ring-teal/30 md:text-sm"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label={t("send")}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-violet text-white outline-none transition-opacity focus-visible:ring-3 focus-visible:ring-violet/50 disabled:opacity-40"
        >
          <ArrowUpIcon aria-hidden className="size-5" />
        </button>
      </form>
    </motion.section>
  );
}

/** Jarvis speaks from the left, marked by a teal edge. */
function AssistantBubble({ text }: { text: string }) {
  return (
    <div className="max-w-[88%] self-start rounded-2xl rounded-tl-md border-l-[3px] border-teal bg-surface-hover px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">
      {text}
    </div>
  );
}

/** The user's messages sit on the right in violet. */
function UserBubble({ text }: { text: string }) {
  return (
    <div className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-violet px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-white">
      {text}
    </div>
  );
}

function TypingDots({ label }: { label: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      role="status"
      aria-label={label}
      className="flex items-center gap-1.5 self-start rounded-2xl rounded-tl-md border-l-[3px] border-teal bg-surface-hover px-4 py-3.5"
    >
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          aria-hidden
          className="size-2 rounded-full bg-teal"
          animate={reduceMotion ? { opacity: 0.8 } : { y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: index * 0.15 }
          }
        />
      ))}
    </div>
  );
}
