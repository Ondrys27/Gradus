"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { FileCodeIcon, FileTextIcon, NetworkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { track } from "@/lib/analytics/client";
import { countNodes } from "@/lib/mindmap/formats";
import { useSession } from "@/features/account/queries";
import { formatDateTime } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { draftFromDoc, type DocNode, type NoteDraft } from "./document";
import { ConvertDialog } from "./mindmap/convert-dialog";
import { mapToMindTree, textDocToMap } from "./mindmap/convert";
import { mapDraft } from "./mindmap/map-doc";
import { downloadTree, NoteMenu, TEXT_EXPORTS, type TextExport } from "./mindmap/note-menu";
import { EditorToolbar, LINK_SHORTCUT_EVENT } from "./editor-toolbar";
import { isAllowedLink } from "./links";
import { useNoteBacklinks } from "./link-queries";
import { createRecordMention, MentionMenuBridge, MentionTargetsContext } from "./mention-extension";
import { MentionMenu } from "./mention-menu";
import { useMentionTargets, useMentionText } from "./mention-queries";
import {
  mentionAttrsOf,
  mentionSetKey,
  mentionsInDoc,
  staleLabels,
  type MentionAttrs,
  type MentionTarget,
} from "./mentions";
import { applyDraftToCache, NOTE_REPLACED_EVENT, useNoteSaver, type NoteDetail } from "./queries";
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
  /** The note as a mind map: in place (it becomes a map) or as a new note. */
  onConvert?: (draft: NoteDraft, how: "replace" | "new") => void;
};

/** What the note belongs to, quietly above its text, each with a link back. */
export function Backlinks({ noteId }: { noteId: string }) {
  const t = useTranslations("notes");
  const links = useNoteBacklinks(noteId);
  const items = links.data ?? [];
  if (items.length === 0) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-ink-muted" data-testid="note-backlinks">
      <span>{t("belongsTo")}</span>
      {items.map((item) => (
        <Link
          key={item.linkId}
          href={item.href}
          className="inline-flex min-h-8 items-center rounded-md font-medium text-ink-soft underline decoration-line underline-offset-2 hover:text-ink"
          aria-label={t(`belongsToKind.${item.kind}`, { title: item.title })}
        >
          {item.title}
        </Link>
      ))}
    </p>
  );
}

/**
 * Chips show the record's current name: a renamed contact reads its new name
 * as soon as the note opens. The stored label is brought in line quietly
 * (no save, no undo step); the next edit saves it with the text.
 */
function refreshMentionLabels(editor: Editor, targets: ReadonlyMap<string, MentionTarget>) {
  const nodes: { pos: number; attrs: MentionAttrs }[] = [];
  editor.state.doc.descendants((node, pos) => {
    const attrs = mentionAttrsOf({ type: node.type.name, attrs: node.attrs });
    if (attrs) nodes.push({ pos, attrs });
  });
  const stale = staleLabels(nodes, targets);
  if (stale.length === 0) return;
  const tr = editor.state.tr;
  for (const { pos, label } of stale) {
    const node = tr.doc.nodeAt(pos);
    if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, label });
  }
  tr.setMeta("preventUpdate", true).setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

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

export function NoteEditor({ note, readOnly, autoFocus, isPhone, actions, back, onConvert }: Props) {
  const t = useTranslations("notes");
  const tMap = useTranslations("notes.map");
  const tio = useTranslations("milestones.mapIo");
  const [converting, setConverting] = useState(false);
  const { user } = useSession();
  const queryClient = useQueryClient();
  const saver = useNoteSaver();
  const settings = useFormatSettings();
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardInset = useKeyboardInset(isPhone && focused);
  const mentionText = useMentionText();
  const [menu] = useState(() => new MentionMenuBridge());
  const [mentions, setMentions] = useState(() => mentionsInDoc(note.content));
  const targets = useMentionTargets(mentions);

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
      createRecordMention(menu),
    ],
    [t, menu],
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
        const doc = e.getJSON() as DocNode;
        const draft = draftFromDoc(doc, { mentionText });
        saver.edit(note.id, draft);
        applyDraftToCache(queryClient, user.id, note.id, draft);
        const next = mentionsInDoc(doc);
        setMentions((previous) =>
          mentionSetKey(previous) === mentionSetKey(next) ? previous : next,
        );
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

  useEffect(() => {
    if (editor && !editor.isDestroyed && targets.data) refreshMentionLabels(editor, targets.data);
  }, [editor, targets.data]);

  // Text added from outside (one of Grady's answers) shows in the open editor
  // too, so the next keystroke does not save over it.
  useEffect(() => {
    if (!editor) return;
    const onReplaced = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; content: DocNode }>).detail;
      if (detail?.id !== note.id) return;
      editor.commands.setContent(detail.content as object, { emitUpdate: false });
    };
    window.addEventListener(NOTE_REPLACED_EVENT, onReplaced);
    return () => window.removeEventListener(NOTE_REPLACED_EVENT, onReplaced);
  }, [editor, note.id]);

  // Leaving the note (another note, another page) sends its text right away.
  useEffect(() => {
    const id = note.id;
    return () => {
      void saver.flush(id);
    };
  }, [note.id, saver]);

  const showToolbar = !!editor && !readOnly;

  /** The text as it is now (the editor's, or the stored one before it loads), as a map. */
  const asMap = () =>
    textDocToMap((editor?.getJSON() as DocNode | undefined) ?? (note.content as DocNode), note.title);

  function exportAs(format: TextExport) {
    downloadTree(format, mapToMindTree(asMap()), tio("fileFallback"));
    track("mindmap_exported", { format, from: "text_note" });
  }

  function convert(how: "replace" | "new") {
    setConverting(false);
    const map = asMap();
    track("note_converted", {
      to: "mindmap",
      how,
      nodes: Math.min(countNodes(mapToMindTree(map)), 5000),
    });
    onConvert?.(mapDraft(map, { mentionText }), how);
  }

  const moreMenu = (
    <NoteMenu
      label={tMap("menu")}
      groups={[
        ...(onConvert && !readOnly
          ? [
              {
                items: [
                  {
                    key: "toMap",
                    label: tMap("toMap"),
                    icon: <NetworkIcon aria-hidden />,
                    onSelect: () => setConverting(true),
                    testId: "note-to-map",
                  },
                ],
              },
            ]
          : []),
        {
          label: tMap("exportLabel"),
          items: TEXT_EXPORTS.map((format) => ({
            key: format,
            label: tMap(`export.${format}`),
            icon:
              format === "markdown" ? (
                <FileTextIcon aria-hidden />
              ) : format === "opml" ? (
                <FileCodeIcon aria-hidden />
              ) : (
                <NetworkIcon aria-hidden />
              ),
            onSelect: () => exportAs(format),
            testId: `note-export-${format}`,
          })),
        },
      ]}
    />
  );

  return (
    <div className="flex min-h-full flex-col">
      {isPhone ? (
        <div className="sticky top-0 z-10 flex items-center gap-1 bg-canvas px-4 pt-[max(4px,env(safe-area-inset-top))] pb-1">
          {back}
          <span className="flex-1" />
          {moreMenu}
          {actions}
        </div>
      ) : (
        <div className="sticky top-0 z-10 -mx-2 flex items-center gap-2 rounded-2xl bg-canvas/50 px-1 py-1 backdrop-blur-xl">
          {showToolbar ? (
            <EditorToolbar
              editor={editor}
              onMention={() => (menu.via = "button")}
              className="min-w-0 flex-1"
            />
          ) : (
            <span className="flex-1" />
          )}
          <div className="flex shrink-0 items-center">
            {moreMenu}
            {actions}
          </div>
        </div>
      )}

      <div className={cn("flex-1", isPhone ? "px-5 pb-32" : "pb-16")}>
        <Backlinks noteId={note.id} />
        <p className="mt-3 mb-5 text-center text-xs text-ink-muted">
          <time dateTime={note.updated_at}>{formatDateTime(new Date(note.updated_at), settings)}</time>
          <span className="mx-2">·</span>
          <SaveStatus noteId={note.id} />
        </p>
        <MentionTargetsContext.Provider value={targets.data}>
          <EditorContent editor={editor} />
        </MentionTargetsContext.Provider>
        {!readOnly && <MentionMenu bridge={menu} />}
      </div>

      {showToolbar && isPhone && focused && (
        <div
          className="fixed inset-x-0 z-overlay border-t border-line/50 bg-surface/95 px-2 py-1 pr-[max(8px,env(safe-area-inset-right))] pl-[max(8px,env(safe-area-inset-left))] backdrop-blur-xl"
          style={{ bottom: keyboardInset }}
        >
          <EditorToolbar
            editor={editor}
            onMention={() => (menu.via = "button")}
            onDone={() => editor.commands.blur()}
          />
        </div>
      )}
      <ConvertDialog
        to={converting ? "mindmap" : null}
        onClose={() => setConverting(false)}
        onConvert={convert}
      />
    </div>
  );
}
