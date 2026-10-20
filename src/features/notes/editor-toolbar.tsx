"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  AtSignIcon,
  BoldIcon,
  CheckIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  PilcrowIcon,
  Unlink2Icon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { normalizeLink } from "./links";

type Props = {
  editor: Editor;
  className?: string;
  /** Phone: a "Done" that closes the keyboard. */
  onDone?: () => void;
  /** "Link to…" was used: it types @ and the record menu opens. */
  onMention?: () => void;
};

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      // Keeps the editor's selection: the tap must not take the focus away.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-xl text-ink-soft transition-colors mouse:size-9 [&_svg]:size-[18px]",
        "hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        active && "bg-violet/15 text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line/70" />;
}

/** Headings, marks, lists and links; every button has a keyboard shortcut too. */
/**
 * Types @ at the caret (after a space when it follows a word, so the record
 * menu opens) and leaves the cursor behind it.
 */
export function insertMentionTrigger(editor: Editor) {
  const { from } = editor.state.selection;
  const before = from > 1 ? editor.state.doc.textBetween(from - 1, from, "\n", " ") : "";
  const text = before && !/\s/.test(before) ? " @" : "@";
  editor.chain().focus().insertContent(text).run();
}

export function EditorToolbar({ editor, className, onDone, onMention }: Props) {
  const t = useTranslations("notes.editor");
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      paragraph: e.isActive("paragraph") && !e.isActive("listItem") && !e.isActive("taskItem"),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  function openLink() {
    setHref(state.href);
    setLinking(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const openLinkRef = useRef(openLink);
  openLinkRef.current = openLink;
  useEffect(() => {
    const open = () => openLinkRef.current();
    window.addEventListener(LINK_SHORTCUT_EVENT, open);
    return () => window.removeEventListener(LINK_SHORTCUT_EVENT, open);
  }, []);

  function applyLink() {
    const url = normalizeLink(href);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (url) {
      if (editor.state.selection.empty && !state.link) {
        // Nothing selected: the address itself becomes the linked text.
        chain
          .insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] })
          .run();
      } else {
        chain.setLink({ href: url }).run();
      }
    } else {
      chain.unsetLink().run();
    }
    setLinking(false);
  }

  if (linking) {
    return (
      <form
        className={cn("flex items-center gap-1.5", className)}
        onSubmit={(event) => {
          event.preventDefault();
          applyLink();
        }}
      >
        <input
          ref={inputRef}
          type="url"
          inputMode="url"
          value={href}
          onChange={(event) => setHref(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setLinking(false);
              editor.commands.focus();
            }
          }}
          placeholder={t("linkPlaceholder")}
          aria-label={t("link")}
          className="min-w-0 flex-1 !min-h-11 mouse:!min-h-9"
        />
        <ToolButton label={t("linkApply")} onClick={applyLink}>
          <CheckIcon />
        </ToolButton>
        {state.link && (
          <ToolButton
            label={t("linkRemove")}
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              setLinking(false);
            }}
          >
            <Unlink2Icon />
          </ToolButton>
        )}
        <ToolButton
          label={t("linkCancel")}
          onClick={() => {
            setLinking(false);
            editor.commands.focus();
          }}
        >
          <XIcon />
        </ToolButton>
      </form>
    );
  }

  const chain = () => editor.chain().focus();
  return (
    <div
      role="toolbar"
      aria-label={t("toolbar")}
      className={cn("flex items-center gap-0.5 overflow-x-auto overscroll-x-contain", className)}
    >
      <ToolButton
        label={`${t("heading1")} (⌘⌥1)`}
        active={state.h1}
        onClick={() => chain().toggleHeading({ level: 1 }).run()}
      >
        <Heading1Icon />
      </ToolButton>
      <ToolButton
        label={`${t("heading2")} (⌘⌥2)`}
        active={state.h2}
        onClick={() => chain().toggleHeading({ level: 2 }).run()}
      >
        <Heading2Icon />
      </ToolButton>
      <ToolButton
        label={`${t("heading3")} (⌘⌥3)`}
        active={state.h3}
        onClick={() => chain().toggleHeading({ level: 3 }).run()}
      >
        <Heading3Icon />
      </ToolButton>
      <ToolButton
        label={`${t("paragraph")} (⌘⌥0)`}
        active={state.paragraph}
        onClick={() => chain().setParagraph().run()}
      >
        <PilcrowIcon />
      </ToolButton>
      <Divider />
      <ToolButton
        label={`${t("bold")} (⌘B)`}
        active={state.bold}
        onClick={() => chain().toggleBold().run()}
      >
        <BoldIcon />
      </ToolButton>
      <ToolButton
        label={`${t("italic")} (⌘I)`}
        active={state.italic}
        onClick={() => chain().toggleItalic().run()}
      >
        <ItalicIcon />
      </ToolButton>
      <ToolButton label={`${t("link")} (⌘⇧K)`} active={state.link} onClick={openLink}>
        <LinkIcon />
      </ToolButton>
      <ToolButton
        label={`${t("mention")} (@)`}
        onClick={() => {
          onMention?.();
          insertMentionTrigger(editor);
        }}
      >
        <AtSignIcon />
      </ToolButton>
      <Divider />
      <ToolButton
        label={`${t("bulletList")} (⌘⇧8)`}
        active={state.bullet}
        onClick={() => chain().toggleBulletList().run()}
      >
        <ListIcon />
      </ToolButton>
      <ToolButton
        label={`${t("orderedList")} (⌘⇧7)`}
        active={state.ordered}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrderedIcon />
      </ToolButton>
      <ToolButton
        label={`${t("taskList")} (⌘⇧9)`}
        active={state.task}
        onClick={() => chain().toggleTaskList().run()}
      >
        <ListChecksIcon />
      </ToolButton>
      {onDone && (
        <>
          <span className="flex-1" />
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onDone}
            className="h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-violet"
          >
            {t("hideKeyboard")}
          </button>
        </>
      )}
    </div>
  );
}

/** Opens the link field from the keyboard (⌘⇧K; ⌘K stays the app's search). */
export const LINK_SHORTCUT_EVENT = "gradus:notes:link";
