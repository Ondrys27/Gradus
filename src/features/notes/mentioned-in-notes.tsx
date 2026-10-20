"use client";

import Link from "next/link";
import { StickyNoteIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { GlowCard } from "@/components/ui/glow-card";
import { formatEditedAt } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { useNotesInWork } from "./link-queries";
import { useNotesMentioning } from "./mention-queries";
import type { MentionKind } from "./mentions";
import { noteHref } from "./work-notes";

type Props = {
  kind: MentionKind;
  id: string;
  /** Called before leaving for the note (closes a surrounding dialog or panel). */
  onOpenNote?: () => void;
  /** On a page of cards (contact, worker): a card of its own. */
  card?: boolean;
  className?: string;
};

/**
 * "Mentioned in notes" on a contact, deal, event or worker: the notes whose
 * text links to it with @. Notes are private, so only the account's own space
 * shows it; nothing at all when no note mentions the record.
 */
export function MentionedInNotes({ kind, id, onOpenNote, card = false, className }: Props) {
  const t = useTranslations("notes.mentioned");
  const tn = useTranslations("notes");
  const settings = useFormatSettings();
  const { allowed } = useNotesInWork();
  const notes = useNotesMentioning(kind, id, allowed);
  const items = notes.data ?? [];
  if (!allowed || items.length === 0) return null;

  const section = (
    <section
      aria-labelledby={`mentioned-${kind}-${id}`}
      data-testid="mentioned-in-notes"
      className={cn("flex flex-col gap-2", className)}
    >
      <h3 id={`mentioned-${kind}-${id}`} className="micro-label flex items-center gap-1.5">
        <StickyNoteIcon aria-hidden className="size-3.5" />
        {t("title")}
      </h3>
      <ul className="flex flex-col gap-1">
        {items.map((note) => (
          <li key={note.id}>
            <Link
              href={noteHref(note.id)}
              onClick={onOpenNote}
              className="flex min-h-11 flex-col justify-center rounded-xl border border-line bg-canvas-deep/40 px-3 py-2 outline-none transition-colors hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span
                className={cn(
                  "truncate text-sm font-semibold",
                  note.title ? "text-ink" : "text-ink-muted",
                )}
              >
                {note.title || tn("untitled")}
              </span>
              <span className="truncate text-xs text-ink-muted">
                {formatEditedAt(new Date(note.updated_at), settings)}
                {note.preview ? ` · ${note.preview}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
  return card ? <GlowCard interactive={false}>{section}</GlowCard> : section;
}
