"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LinkIcon, NotebookPenIcon, StickyNoteIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { formatEditedAt } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  useLinkedNotes,
  useLinkNote,
  useNotesInWork,
  useUnlinkNote,
  useWriteToNotes,
  type WorkTarget,
} from "./link-queries";
import { NotePicker } from "./note-picker";
import type { NoteTemplateKey } from "./templates";

/** Where a note opens: the Notes page with it selected. */
export function noteHref(noteId: string): string {
  return `/app/poznamky?note=${encodeURIComponent(noteId)}`;
}

/**
 * "Write in notes" from a task or milestone: makes the note, ties it and
 * opens it. Shared by the Notes section and the task row's shortcut.
 */
export function useWriteAndOpen() {
  const router = useRouter();
  const write = useWriteToNotes();
  return {
    pending: write.isPending,
    failed: write.isError,
    run: (target: WorkTarget, title: string, template: NoteTemplateKey | null, onOpen?: () => void) =>
      write.mutate(
        { target, title, template },
        {
          onSuccess: (id) => {
            onOpen?.();
            router.push(noteHref(id));
          },
        },
      ),
  };
}

type Props = {
  target: WorkTarget;
  /** The task's or milestone's title: the new note's first line. */
  title: string;
  /** A step whose result is a text: writing is the main action, with this outline. */
  template: NoteTemplateKey | null;
  /** Called before leaving for the note (closes a surrounding dialog). */
  onOpenNote?: () => void;
  className?: string;
};

/**
 * The Notes part of a task or milestone: the notes tied to it, "Attach a
 * note" with a searchable choice, and "Write in notes". Only in the account's
 * own space; notes are private, so a worker never gets it.
 */
export function WorkNotes({ target, title, template, onOpenNote, className }: Props) {
  const t = useTranslations("notes.work");
  const tn = useTranslations("notes");
  const settings = useFormatSettings();
  const { allowed, readOnly } = useNotesInWork();
  const linked = useLinkedNotes(target, allowed);
  const link = useLinkNote();
  const unlink = useUnlinkNote();
  const write = useWriteAndOpen();
  const [picking, setPicking] = useState(false);

  if (!allowed) return null;
  const notes = linked.data ?? [];
  const failed = link.isError || unlink.isError || write.failed;

  return (
    <section
      aria-labelledby={`work-notes-${target.id}`}
      data-testid="work-notes"
      className={cn("flex flex-col gap-3", className)}
    >
      <h3 id={`work-notes-${target.id}`} className="micro-label flex items-center gap-1.5">
        <StickyNoteIcon aria-hidden className="size-3.5" />
        {t("title")}
      </h3>

      {template && notes.length === 0 && (
        <p className="text-sm text-pretty text-ink-soft">
          {t("templateHint", { outline: tn(`templates.${template}.title`) })}
        </p>
      )}

      {notes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {notes.map((note) => (
            <li
              key={note.linkId}
              className="flex min-h-11 items-center gap-1 rounded-xl border border-line bg-canvas-deep/40 pl-3"
            >
              <Link
                href={noteHref(note.id)}
                onClick={onOpenNote}
                className="flex min-w-0 flex-1 flex-col py-2 outline-none focus-visible:underline"
              >
                <span className={cn("truncate text-sm font-semibold", note.title ? "text-ink" : "text-ink-muted")}>
                  {note.title || tn("untitled")}
                </span>
                <span className="truncate text-xs text-ink-muted">
                  {formatEditedAt(new Date(note.updated_at), settings)}
                  {note.preview ? ` · ${note.preview}` : ""}
                </span>
              </Link>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => unlink.mutate({ linkId: note.linkId, kind: target.kind })}
                  aria-label={t("unlink", { title: note.title || tn("untitled") })}
                  title={t("unlink", { title: note.title || tn("untitled") })}
                  className="grid size-11 shrink-0 place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
                >
                  <XIcon aria-hidden className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={template ? "default" : "outline"}
            disabled={write.pending}
            onClick={() => write.run(target, title, template, onOpenNote)}
            data-testid="work-notes-write"
          >
            <NotebookPenIcon aria-hidden data-icon="inline-start" />
            {t("write")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={picking}
            onClick={() => setPicking((value) => !value)}
          >
            <LinkIcon aria-hidden data-icon="inline-start" />
            {t("attach")}
          </Button>
        </div>
      )}

      {picking && !readOnly && (
        <NotePicker
          label={t("pickLabel")}
          excludeIds={notes.map((note) => note.id)}
          disabled={link.isPending}
          onPick={(noteId) =>
            link.mutate({ noteId, target }, { onSuccess: () => setPicking(false) })
          }
          className="rounded-2xl border border-line p-2"
        />
      )}

      {failed && <FormAlert>{t("failed")}</FormAlert>}
    </section>
  );
}
