"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { useTranslations } from "next-intl";
import { useSession } from "@/features/account/queries";
import { formatDateTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { draftFromDoc, type DocNode } from "./document";
import { EditorToolbar, LINK_SHORTCUT_EVENT } from "./editor-toolbar";
import { isAllowedLink } from "./links";
import { applyDraftToCache, useNoteSaver, type NoteDetail } from "./queries";
import { useKeyboardInset } from "./use-keyboard-inset";

/** ⌘⇧K opens the link field (⌘K is the app's search). */
const LinkShortcut = Extension.create({
  name: "noteLinkShortcut",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-k": () => {
        window.dispatchEvent(new Event(LINK_SHORTCUT_EVENT));
        return true;
      },
    };
  },
});

type Props = {
  note: NoteDetail;
  readOnly: boolean;
  /** A note just made: the cursor goes in at once. */
  autoFocus: boolean;
  isPhone: boolean;
  /** Pin and delete, next to the formatting. */
  actions: React.ReactNode;
  /** The phone's way back to the list. */
  back: React.ReactNode;
};

/** Saving state of the open note, quietly next to its date. */
export function SaveStatus({ noteId }: { noteId: string }) {
  const t = useTranslations("notes.saveStatus");
  const saver = useNoteSaver();
  useSyncExternalStore(saver.subscribe, saver.getSnapshot, saver.getSnapshot);
  const status = saver.statusOf(noteId);
  if (!status) return null;
  const warn = status === "error" || status === "offline" || status === "tooLarge";
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="note-save-status"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs transition-colors",
        warn ? "text-orange" : "text-ink-muted",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "saved" ? "bg-green/70" : warn ? "bg-orange" : "animate-pulse bg-ink-muted motion-reduce:animate-none",
        )}
      />
      {t(status)}
    </span>
  );
}

export function NoteEditor({ note, readOnly, autoFocus, isPhone, actions, back }: Props) {
  const t = useTranslations("notes");
  const { user } = useSession();
  const queryClient = useQueryClient();
  const saver = useNoteSaver();
  const settings = useFormatSettings();
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardInset = useKeyboardInset(isPhone && focused);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        link: {
          openOnClick: true,
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: "https",
          protocols: ["mailto"],
          isAllowedUri: (url) => isAllowedLink(url),
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: ({ pos }) =>
          pos === 0 ? t("editor.placeholderTitle") : t("editor.placeholderBody"),
      }),
      LinkShortcut,
    ],
    [t],
  );

  const editor = useEditor(
    {
      extensions,
      content: note.content as DocNode as object,
      editable: !readOnly,
      immediatelyRender: false,
      autofocus: autoFocus && !readOnly ? "end" : false,
      editorProps: {
        attributes: {
          class: "note-prose",
          "aria-label": t("editor.label"),
          "data-testid": "note-editor",
        },
      },
      onUpdate: ({ editor: e }) => {
        const draft = draftFromDoc(e.getJSON() as DocNode);
        saver.edit(note.id, draft);
        applyDraftToCache(queryClient, user.id, note.id, draft);
      },
      onFocus: () => {
        if (blurTimer.current) clearTimeout(blurTimer.current);
        setFocused(true);
      },
      // A tap on the formatting bar blurs for a moment; the bar must not vanish under it.
      onBlur: () => {
        if (blurTimer.current) clearTimeout(blurTimer.current);
        blurTimer.current = setTimeout(() => setFocused(false), 200);
      },
    },
    [note.id],
  );

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Leaving the note (another note, another page) sends its text right away.
  useEffect(() => {
    const id = note.id;
    return () => {
      void saver.flush(id);
    };
  }, [note.id, saver]);

  const showToolbar = !!editor && !readOnly;

  return (
    <div className="flex min-h-full flex-col">
      {isPhone ? (
        <div className="sticky top-0 z-10 flex items-center gap-1 bg-canvas px-4 pt-[max(4px,env(safe-area-inset-top))] pb-1">
          {back}
          <span className="flex-1" />
          {actions}
        </div>
      ) : (
        <div className="sticky top-0 z-10 -mx-2 flex items-center gap-2 rounded-2xl bg-canvas/50 px-1 py-1 backdrop-blur-xl">
          {showToolbar ? (
            <EditorToolbar editor={editor} className="min-w-0 flex-1" />
          ) : (
            <span className="flex-1" />
          )}
          <div className="flex shrink-0 items-center">{actions}</div>
        </div>
      )}

      <div className={cn("flex-1", isPhone ? "px-5 pb-32" : "pb-16")}>
        <p className="mt-3 mb-5 text-center text-xs text-ink-muted">
          <time dateTime={note.updated_at}>{formatDateTime(new Date(note.updated_at), settings)}</time>
          <span className="mx-2">·</span>
          <SaveStatus noteId={note.id} />
        </p>
        <EditorContent editor={editor} />
      </div>

      {showToolbar && isPhone && focused && (
        <div
          className="fixed inset-x-0 z-overlay border-t border-line/50 bg-surface/95 px-2 py-1 pr-[max(8px,env(safe-area-inset-right))] pl-[max(8px,env(safe-area-inset-left))] backdrop-blur-xl"
          style={{ bottom: keyboardInset }}
        >
          <EditorToolbar
            editor={editor}
            onDone={() => editor.commands.blur()}
          />
        </div>
      )}
    </div>
  );
}
