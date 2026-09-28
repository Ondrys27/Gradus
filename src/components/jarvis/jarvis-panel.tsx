"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  ArrowUpIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  ImageIcon,
  PaperclipIcon,
  SquarePenIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { JarvisBot } from "@/components/jarvis/jarvis-bot";
import { SuggestionCard, useSuggestionActions } from "@/components/jarvis/suggestion-card";
import {
  ACCEPTED_EXTENSIONS,
  MAX_FILE_BYTES,
  MAX_FILES_PER_MESSAGE,
  uploadContentType,
  type FileKind,
} from "@/features/jarvis/files";
import { MAX_MESSAGE_LENGTH, type SuggestionKey } from "@/features/jarvis/protocol";
import {
  useJarvisConversation,
  useJarvisOverview,
  useJarvisSuggestions,
  useMarkSuggestionsSeen,
} from "@/features/jarvis/queries";
import type { ChatError, useJarvisChat } from "@/features/jarvis/use-jarvis-chat";
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
  const noticed = useJarvisSuggestions();
  const markSeen = useMarkSuggestionsSeen();
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { pending, error } = chat;
  const messages = conversation.data?.messages ?? [];
  const usage = overview.data?.usage;
  const fileUsage = overview.data?.files;
  const suggestions = overview.data?.suggestions ?? [];
  const cards = noticed.data ?? [];
  const busy = pending !== null;
  const actions = useSuggestionActions({
    ask: (prompt) => void chat.send(prompt),
    onNavigate: () => {
      if (isPhone) onClose();
    },
  });

  // Opening the panel shows what Jarvis noticed; the ring on the button stops.
  const unseen = cards.filter((card) => !card.seen).map((card) => card.id);
  const unseenKey = unseen.join(",");
  useEffect(() => {
    if (unseenKey) markSeen.mutate(unseenKey.split(","));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the unseen set changes
  }, [unseenKey]);

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

  async function submit(text: string, attached: File[]) {
    if (busy || (!text.trim() && !attached.length)) return;
    setDraft("");
    setFiles([]);
    const result = await chat.send(text, attached);
    if (result === "accepted") return;
    // Refused before it was saved (limit, connection): the text comes back to the input,
    // and the files too unless they were the reason.
    setDraft((current) => current || text);
    if (result === "refused") setFiles((current) => (current.length ? current : attached));
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(draft, files);
  };

  const onInputKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit(draft, files);
    }
  };

  /** Checks picked files by name and size here; the server checks the content. */
  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!picked.length) return;
    let problem: ChatError["code"] | null = null;
    const accepted: File[] = [];
    for (const file of picked) {
      if (!uploadContentType(file.name)) problem = "fileType";
      else if (file.size > MAX_FILE_BYTES) problem = "fileTooLarge";
      else if (file.size > 0) accepted.push(file);
    }
    const next = [...files, ...accepted];
    if (next.length > MAX_FILES_PER_MESSAGE) problem = "tooManyFiles";
    const kept = next.slice(0, MAX_FILES_PER_MESSAGE);
    if (fileUsage && fileUsage.used + kept.length > fileUsage.limit) {
      chat.showError({ code: "fileLimit" });
      return;
    }
    setFiles(kept);
    if (problem) chat.showError({ code: problem });
    else chat.dismissError();
  };

  const errorText = error ? errorMessage(error) : null;

  function errorMessage(value: ChatError): string {
    switch (value.code) {
      case "limitReached":
        return t("error.limitReached", {
          limit: formatNumber(value.usage?.limit ?? usage?.limit ?? 0, {}, settings),
        });
      case "fileLimit":
        return t("error.fileLimit", { limit: formatNumber(fileUsage?.limit ?? 0, {}, settings) });
      case "fileTooLarge":
        return t("error.fileTooLarge", {
          max: formatNumber(MAX_FILE_BYTES / 1024 / 1024, {}, settings),
        });
      case "tooManyFiles":
        return t("error.tooManyFiles", { max: formatNumber(MAX_FILES_PER_MESSAGE, {}, settings) });
      default:
        return t(`error.${value.code}`);
    }
  }

  const showTyping = pending !== null && !pending.answer;
  const showChips = !busy && suggestions.length > 0 && files.length === 0;
  const canSend = !busy && (draft.trim().length > 0 || files.length > 0);

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

      {cards.length > 0 && (
        <section
          aria-label={t("suggestion.heading")}
          className="max-h-[40%] shrink-0 overflow-y-auto overscroll-contain border-b border-line px-4 py-3"
        >
          <h3 className="micro-label mb-2">{t("suggestion.heading")}</h3>
          <ul className="flex flex-col gap-2">
            {cards.map((card) => (
              <SuggestionCard
                key={card.id}
                suggestion={card}
                busy={busy || actions.undoPending}
                onRun={(value) =>
                  void actions.run(value).catch(() => chat.showError({ code: "unknown" }))
                }
                onDismiss={actions.dismiss}
              />
            ))}
          </ul>
        </section>
      )}

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
            <UserBubble
              key={message.id}
              text={message.content}
              files={message.attachments?.map((file) => ({ name: file.name, kind: file.kind }))}
            />
          ) : (
            <AssistantBubble key={message.id} text={message.content} />
          ),
        )}
        {pending && (pending.userText || pending.fileNames.length > 0) && (
          <UserBubble
            text={pending.userText ?? ""}
            files={pending.fileNames.map((name) => ({ name, kind: null }))}
          />
        )}
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
              onClick={() => void submit(t(`chip.${key}`), [])}
              className="min-h-11 rounded-full border border-teal/40 bg-teal/10 px-3.5 text-left text-sm text-ink outline-none transition-colors hover:bg-teal/20 focus-visible:ring-3 focus-visible:ring-teal/50 mouse:min-h-9"
            >
              {t(`chip.${key}`)}
            </button>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <ul aria-label={t("files.selected")} className="flex flex-wrap gap-2 px-3 pt-3">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-canvas py-1 pr-1 pl-3 text-xs text-ink"
            >
              <span className="max-w-48 truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                aria-label={t("files.remove", { name: file.name })}
                className="grid size-11 place-items-center rounded-full text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-teal/50 mouse:size-7"
              >
                <XIcon aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line px-3 py-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={onPickFiles}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || files.length >= MAX_FILES_PER_MESSAGE}
          aria-label={t("files.attach")}
          title={t("files.hint", {
            max: formatNumber(MAX_FILES_PER_MESSAGE, {}, settings),
            size: formatNumber(MAX_FILE_BYTES / 1024 / 1024, {}, settings),
          })}
          className="grid size-11 shrink-0 place-items-center rounded-full text-ink-soft outline-none transition-colors hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-teal/50 disabled:opacity-40"
        >
          <PaperclipIcon aria-hidden className="size-5" />
        </button>
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
          disabled={!canSend}
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

const FILE_ICONS: Record<FileKind, LucideIcon> = {
  pdf: FileTextIcon,
  docx: FileTextIcon,
  txt: FileTextIcon,
  csv: FileSpreadsheetIcon,
  xlsx: FileSpreadsheetIcon,
  png: ImageIcon,
  jpeg: ImageIcon,
};

/** The user's messages sit on the right in violet, their files above the text. */
function UserBubble({
  text,
  files,
}: {
  text: string;
  files?: { name: string; kind: FileKind | null }[];
}) {
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-1.5 self-end">
      {files && files.length > 0 && (
        <ul className="flex flex-wrap justify-end gap-1.5">
          {files.map((file, index) => {
            const Icon = file.kind ? FILE_ICONS[file.kind] : PaperclipIcon;
            return (
              <li
                key={`${file.name}-${index}`}
                className="flex max-w-full items-center gap-1.5 rounded-full border border-violet/50 bg-violet/15 px-2.5 py-1 text-xs text-ink"
              >
                <Icon aria-hidden className="size-3.5 shrink-0 text-violet" />
                <span className="max-w-44 truncate">{file.name}</span>
              </li>
            );
          })}
        </ul>
      )}
      {text && (
        <div className="rounded-2xl rounded-br-md bg-violet px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-white">
          {text}
        </div>
      )}
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
