"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FileTextIcon, PaperclipIcon, PencilIcon, ReplyIcon, SendHorizontalIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSession } from "@/features/account/queries";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  decodeMentions,
  encodeMentions,
  fold,
  insertMention,
  isImageType,
  mentionQueryAt,
  plainBody,
  type ComposerMention,
} from "./logic";
import { enqueue } from "./outbox-store";
import { PersonAvatar, usePeople } from "./people";
import {
  CHAT_BODY_MAX,
  CHAT_FILE_MAX_BYTES,
  CHAT_FILE_TYPES,
  CHAT_FILES_MAX,
  type ChatMessage,
} from "./types";

type Picked = { id: string; file: File; preview: string | null; width?: number; height?: number };

export type ComposerHandle = { focus: () => void };

type ComposerProps = {
  /** The conversation, or the person a first message goes to. */
  channelId: string | null;
  to: string | null;
  space: string;
  /** Who can be mentioned here (members other than the writer). */
  candidates: readonly string[];
  reply: ChatMessage | null;
  onCancelReply: () => void;
  editing: ChatMessage | null;
  onCancelEdit: () => void;
  onSaveEdit: (message: ChatMessage, body: string) => void;
  onSent: () => void;
  /** Writing is not possible here; the reason is shown instead of the field. */
  blocked: string | null;
};

const DRAFT_PREFIX = "gradus.chat.draft.";

type Draft = { text: string; mentions: ComposerMention[] };

/** Writes the pending draft (an empty one removes the key) and forgets it. */
function saveDraft(unsaved: { current: { key: string; draft: Draft } | null }) {
  const pending = unsaved.current;
  if (!pending) return;
  unsaved.current = null;
  try {
    if (pending.draft.text.trim()) localStorage.setItem(pending.key, JSON.stringify(pending.draft));
    else localStorage.removeItem(pending.key);
  } catch {
    // Storage blocked: the draft lives while the page does.
  }
}

function readDraft(key: string): Draft {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as Draft) : null;
    if (parsed && typeof parsed.text === "string" && Array.isArray(parsed.mentions)) return parsed;
  } catch {
    // Nothing usable.
  }
  return { text: "", mentions: [] };
}

/**
 * Writing a message: Enter sends, Shift+Enter makes a new line, @ suggests
 * the members, files up to 10 MB (five at most), a reply or an edit shown
 * above the field. What is typed stays in the browser until it is sent, also
 * across a reload; a message sent while offline waits in the outbox.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    channelId,
    to,
    space,
    candidates,
    reply,
    onCancelReply,
    editing,
    onCancelEdit,
    onSaveEdit,
    onSent,
    blocked,
  },
  ref,
) {
  const t = useTranslations("messages.composer");
  const tm = useTranslations("messages");
  const settings = useFormatSettings();
  const { user } = useSession();
  const { byMember, nameOf } = usePeople();
  const draftKey = `${DRAFT_PREFIX}${user.id}.${channelId ?? `to:${to}`}`;
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<ComposerMention[]>([]);
  const [files, setFiles] = useState<Picked[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => field.current?.focus() }), []);

  // The draft of this conversation, or the message being edited.
  useEffect(() => {
    if (editing) {
      const decoded = decodeMentions(editing.body, nameOf);
      setText(decoded.text);
      setMentions(decoded.mentions);
    } else {
      const draft = readDraft(draftKey);
      setText(draft.text);
      setMentions(draft.mentions);
    }
    setFiles([]);
    setError(null);
    // nameOf changes when people load; the edit is decoded once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, editing?.id]);

  // The draft not written yet: saved 300 ms after the last key, and at once
  // when the conversation changes, the composer goes or the tab is hidden, so
  // the last words typed are never lost.
  const unsaved = useRef<{ key: string; draft: Draft } | null>(null);
  useEffect(() => {
    if (editing) return;
    unsaved.current = { key: draftKey, draft: { text, mentions } };
    const timer = window.setTimeout(() => saveDraft(unsaved), 300);
    return () => window.clearTimeout(timer);
  }, [text, mentions, draftKey, editing]);
  useEffect(() => {
    const flush = () => saveDraft(unsaved);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      flush();
    };
  }, [draftKey]);

  // The field grows with the text up to a third of the screen.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, Math.round(window.innerHeight * 0.35))}px`;
  }, [text]);

  const query = useMemo(() => {
    const found = mentionQueryAt(text, caret);
    return found && found.start !== dismissedAt ? found : null;
  }, [text, caret, dismissedAt]);
  const suggestions = useMemo(() => {
    if (!query) return [];
    const needle = fold(query.query);
    return candidates
      .map((member) => ({ member, label: nameOf(member) }))
      .filter((item) => !needle || fold(item.label).includes(needle))
      .slice(0, 6);
  }, [query, candidates, nameOf]);
  const menuOpen = suggestions.length > 0;

  useEffect(() => setHighlighted(0), [query?.start, query?.query]);

  const pick = useCallback(
    (member: string, label: string) => {
      if (!query) return;
      const next = insertMention(text, { start: query.start, caret }, label);
      setText(next.text);
      setMentions((list) => [...list.filter((item) => item.member !== member), { member, label }]);
      setCaret(next.caret);
      pendingCaret.current = next.caret;
    },
    [query, text, caret],
  );

  // The caret goes behind the inserted mention right after the render, before
  // the next key press (a frame later would pull it back from typed text).
  useLayoutEffect(() => {
    const at = pendingCaret.current;
    if (at === null || !field.current) return;
    pendingCaret.current = null;
    field.current.focus();
    field.current.setSelectionRange(at, at);
  }, [text]);

  const body = encodeMentions(text, mentions);
  const tooLong = body.length > CHAT_BODY_MAX;
  const empty = !text.trim() && files.length === 0;

  function submit() {
    if (tooLong || empty || blocked) return;
    if (editing) {
      if (!text.trim() && editing.attachments.length === 0) return;
      onSaveEdit(editing, body);
      return;
    }
    const blobs = new Map<string, Blob>(files.map((item) => [item.id, item.file]));
    enqueue(
      {
        id: crypto.randomUUID(),
        space,
        channelId,
        to: channelId ? null : to,
        body: text.trim() ? body : "",
        replyTo: reply?.id ?? null,
        files: files.map((item) => ({
          id: item.id,
          name: item.file.name.slice(0, 200) || "file",
          mime: item.file.type,
          size: item.file.size,
          ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
          uploaded: false,
        })),
        createdAt: new Date().toISOString(),
        attempts: 0,
        nextAt: 0,
        failed: false,
      },
      blobs,
    );
    for (const item of files) if (item.preview) URL.revokeObjectURL(item.preview);
    setText("");
    setMentions([]);
    setFiles([]);
    setError(null);
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // Nothing to clear.
    }
    onCancelReply();
    onSent();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (menuOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlighted((index) => (index + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const item = suggestions[highlighted];
        if (item) pick(item.member, item.label);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedAt(query?.start ?? null);
        return;
      }
    }
    if (event.key === "Escape" && (editing || reply)) {
      event.preventDefault();
      if (editing) onCancelEdit();
      else onCancelReply();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const next: Picked[] = [];
    for (const file of Array.from(list)) {
      if (files.length + next.length >= CHAT_FILES_MAX) {
        setError(t("tooMany", { count: CHAT_FILES_MAX }));
        break;
      }
      if (!(CHAT_FILE_TYPES as readonly string[]).includes(file.type)) {
        setError(t("badType", { name: file.name }));
        continue;
      }
      if (file.size > CHAT_FILE_MAX_BYTES || file.size === 0) {
        setError(t("tooLarge", { name: file.name, size: formatNumber(CHAT_FILE_MAX_BYTES / 1024 / 1024, {}, settings) }));
        continue;
      }
      const picked: Picked = { id: crypto.randomUUID(), file, preview: null };
      if (isImageType(file.type)) {
        picked.preview = URL.createObjectURL(file);
        try {
          const bitmap = await createImageBitmap(file);
          picked.width = bitmap.width;
          picked.height = bitmap.height;
          bitmap.close();
        } catch {
          // Unknown size: the bubble keeps a default shape.
        }
      }
      next.push(picked);
    }
    setFiles((current) => [...current, ...next]);
    if (picker.current) picker.current.value = "";
    field.current?.focus();
  }

  if (blocked) {
    return (
      <div className="border-t border-line px-4 py-3 text-center text-sm text-ink-muted" data-testid="chat-blocked">
        {blocked}
      </div>
    );
  }

  const context = editing ?? reply;
  return (
    <div className="relative border-t border-line bg-surface/60 px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] backdrop-blur md:px-3">
      {menuOpen && (
        <ul
          role="listbox"
          aria-label={t("mentionList")}
          data-testid="chat-mention-menu"
          className="absolute right-2 bottom-full left-2 mb-2 max-h-64 overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover md:right-auto md:w-80"
        >
          {suggestions.map((item, index) => (
            <li key={item.member} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(item.member, item.label)}
                className={cn(
                  "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[15px] mouse:min-h-9",
                  index === highlighted ? "bg-surface-hover text-ink" : "text-ink-soft",
                )}
              >
                <PersonAvatar person={byMember.get(item.member)} name={item.label} className="size-7 text-xs" />
                <span className="truncate">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {context && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border-l-3 border-violet bg-violet/10 px-3 py-1.5 text-sm">
          {editing ? <PencilIcon aria-hidden className="size-4 shrink-0 text-violet" /> : <ReplyIcon aria-hidden className="size-4 shrink-0 text-violet" />}
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-violet">
              {editing ? t("editing") : t("replyingTo", { name: nameOf(context.sender) })}
            </span>
            <span className="block truncate text-ink-soft">
              {plainBody(context.body, nameOf) || tm("attachmentCount", { count: context.attachments.length })}
            </span>
          </span>
          <button
            type="button"
            aria-label={editing ? t("cancelEdit") : t("cancelReply")}
            onClick={editing ? onCancelEdit : onCancelReply}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
          >
            <XIcon aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label={t("files")}>
          {files.map((item) => (
            <li key={item.id} className="relative flex items-center gap-2 rounded-xl border border-line bg-canvas-deep/50 py-1 pr-1 pl-1.5">
              {item.preview ? (
                // A local preview of the picked file (an object URL).
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.preview} alt="" className="size-10 rounded-lg object-cover" />
              ) : (
                <FileTextIcon aria-hidden className="size-5 text-ink-muted" />
              )}
              <span className="max-w-40 truncate text-sm">{item.file.name}</span>
              <button
                type="button"
                aria-label={t("removeFile", { name: item.file.name })}
                onClick={() => {
                  if (item.preview) URL.revokeObjectURL(item.preview);
                  setFiles((list) => list.filter((entry) => entry.id !== item.id));
                }}
                className="grid size-11 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-7"
              >
                <XIcon aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mb-2 px-1 text-sm text-pink">
          {error}
        </p>
      )}

      <div className="flex items-end gap-1.5">
        {!editing && (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              data-testid="chat-file-input"
              accept={CHAT_FILE_TYPES.join(",")}
              onChange={(event) => void addFiles(event.target.files)}
            />
            <button
              type="button"
              aria-label={t("attach")}
              title={t("attach")}
              onClick={() => picker.current?.click()}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl text-ink-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40"
            >
              <PaperclipIcon aria-hidden className="size-5" />
            </button>
          </>
        )}
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("label")}</span>
          <textarea
            ref={field}
            rows={1}
            value={text}
            data-testid="chat-input"
            placeholder={t("placeholder")}
            aria-invalid={tooLong || undefined}
            onChange={(event) => {
              setText(event.target.value);
              setCaret(event.target.selectionStart);
              setDismissedAt(null);
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            enterKeyHint="send"
            className="block max-h-[35vh] min-h-11 w-full resize-none rounded-xl border border-line bg-canvas-deep/60 px-3 py-2.5 text-base leading-snug text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/25 md:text-[15px]"
          />
        </label>
        <button
          type="submit"
          aria-label={editing ? t("save") : t("send")}
          data-testid="chat-send"
          disabled={empty || tooLong}
          onClick={submit}
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl bg-primary text-primary-foreground shadow-glow outline-none transition-opacity focus-visible:ring-3 focus-visible:ring-violet/40 disabled:cursor-default disabled:opacity-40"
        >
          <SendHorizontalIcon aria-hidden className="size-5" />
        </button>
      </div>
      {body.length > CHAT_BODY_MAX - 200 && (
        <p className={cn("mt-1 px-1 text-right text-xs", tooLong ? "text-pink" : "text-ink-muted")}>
          {t("length", {
            count: formatNumber(body.length, {}, settings),
            max: formatNumber(CHAT_BODY_MAX, {}, settings),
          })}
        </p>
      )}
    </div>
  );
});
