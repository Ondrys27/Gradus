"use client";

import { FileTextIcon, NetworkIcon, PinIcon, SearchIcon, Trash2Icon, UsersRoundIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatEditedAt } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { DemoBadge } from "@/features/tutorial/demo-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { groupNotes } from "./notes-logic";
import type { NoteListItem } from "./queries";
import { NOTE_DRAG_TYPE } from "./sharing/notes-nav";

type Props = {
  notes: NoteListItem[] | undefined;
  /** Search results in rank order, or null when nothing is searched. */
  results: NoteListItem[] | null;
  searching: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** What the list shows when the open part of the panel holds no note. */
  emptyText?: string;
  /** The account's own notes can be dragged onto a folder. */
  draggable?: boolean;
  /** Asks to move a note to the trash (its bin, or Delete / Backspace on its row); none when read-only. */
  onRequestDelete?: (note: NoteListItem, viaKeyboard: boolean) => void;
  loadError: boolean;
  onRetry: () => void;
};

function NoteRow({
  note,
  selected,
  onSelect,
  onRequestDelete: requestDelete,
  draggable,
}: {
  note: NoteListItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onRequestDelete?: (note: NoteListItem, viaKeyboard: boolean) => void;
  draggable?: boolean;
}) {
  const t = useTranslations("notes");
  const settings = useFormatSettings();
  const title = note.title || t("untitled");
  const own = (note.role ?? "owner") === "owner";
  // Only the owner moves a note to the trash; a shared one is removed from the list in the note.
  const onRequestDelete = own ? requestDelete : undefined;
  return (
    <li className="group relative">
      <button
        type="button"
        data-tutorial="note-item"
        draggable={draggable && own}
        onDragStart={(event) => {
          event.dataTransfer.setData(NOTE_DRAG_TYPE, note.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => onSelect(note.id)}
        onKeyDown={(event) => {
          if (!onRequestDelete || (event.key !== "Delete" && event.key !== "Backspace")) return;
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          event.preventDefault();
          onRequestDelete(note, true);
        }}
        aria-current={selected ? "true" : undefined}
        data-testid="note-row"
        data-note-row={note.id}
        data-role={note.role ?? "owner"}
        className={cn(
          "flex min-h-14 w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition-colors",
          "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          onRequestDelete && "pr-13 mouse:pr-11",
          selected ? "bg-violet/14" : "hover:bg-surface/70",
        )}
      >
        <span className="flex items-center gap-1.5">
          {note.kind === "mindmap" ? (
            <NetworkIcon
              aria-label={t("kind.mindmap")}
              data-testid="note-kind-mindmap"
              className="size-3.5 shrink-0 text-teal"
            />
          ) : (
            <FileTextIcon aria-label={t("kind.text")} className="size-3.5 shrink-0 text-ink-muted" />
          )}
          {note.pinned && <PinIcon aria-label={t("pinnedLabel")} className="size-3 shrink-0 text-gold" />}
          {note.shared && (
            <UsersRoundIcon
              aria-label={t("sharing.sharedNote")}
              data-testid="note-row-shared"
              className="size-3 shrink-0 text-teal"
            />
          )}
          <span className={cn("truncate font-semibold", note.title ? "text-ink" : "text-ink-muted")}>
            {title}
          </span>
          <DemoBadge show={note.is_demo} className="shrink-0" />
        </span>
        <span className="flex min-w-0 gap-2 text-sm">
          <span className="shrink-0 text-ink-soft tabular-nums">
            {formatEditedAt(new Date(note.updated_at), settings)}
          </span>
          <span className="truncate text-ink-muted">
            {!own && note.owner_name ? `${note.owner_name} · ` : ""}
            {note.preview || t("noText")}
          </span>
        </span>
      </button>
      {onRequestDelete && (
        // Always there on a phone; on a computer it shows on hover or focus.
        <button
          type="button"
          onClick={() => onRequestDelete(note, false)}
          aria-label={t("moveToTrash", { title })}
          title={t("moveToTrash", { title })}
          data-testid="note-row-delete"
          className={cn(
            "absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-destructive outline-none transition-opacity",
            "hover:bg-destructive/12 focus-visible:ring-3 focus-visible:ring-destructive/40 mouse:size-9",
            "mouse:opacity-0 mouse:group-focus-within:opacity-100 mouse:group-hover:opacity-100 mouse:focus-visible:opacity-100",
          )}
        >
          <Trash2Icon aria-hidden className="size-4" />
        </button>
      )}
    </li>
  );
}

function Group({
  label,
  notes,
  selectedId,
  onSelect,
  onRequestDelete,
  draggable,
}: {
  label: string | null;
  notes: NoteListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRequestDelete?: (note: NoteListItem, viaKeyboard: boolean) => void;
  draggable?: boolean;
}) {
  if (notes.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      {label && <h2 className="micro-label px-3 pt-3 pb-1">{label}</h2>}
      <ul className="flex flex-col gap-0.5">
        {notes.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            selected={note.id === selectedId}
            onSelect={onSelect}
            onRequestDelete={onRequestDelete}
            draggable={draggable}
          />
        ))}
      </ul>
    </section>
  );
}

/** Search on top, then Pinned and the other notes, Recently Deleted at the bottom. */
export function NotesList({
  notes,
  results,
  searching,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  emptyText,
  draggable,
  onRequestDelete,
  loadError,
  onRetry,
}: Props) {
  const t = useTranslations("notes");
  const groups = groupNotes(notes ?? []);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              onQueryChange("");
            }
          }}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          data-testid="notes-search"
          className="!border-transparent !bg-surface/60 !pl-10 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label={t("clearSearch")}
            className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-ink-muted hover:text-ink mouse:size-8"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>

      {loadError ? (
        <div className="flex flex-col items-start gap-2 px-3 py-4 text-sm text-ink-muted">
          {t("loadError")}
          <button type="button" onClick={onRetry} className="font-semibold text-violet">
            {t("retry")}
          </button>
        </div>
      ) : !notes ? (
        <div className="flex flex-col gap-3 px-3 py-3" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : results ? (
        results.length > 0 ? (
          <Group
            label={null}
            notes={results}
            selectedId={selectedId}
            onSelect={onSelect}
            onRequestDelete={onRequestDelete}
            draggable={draggable}
          />
        ) : (
          <p className="px-3 py-4 text-sm text-ink-muted">
            {searching ? t("searching") : t("noResults", { query })}
          </p>
        )
      ) : (
        <>
          <Group
            label={t("pinnedGroup")}
            notes={groups.pinned}
            selectedId={selectedId}
            onSelect={onSelect}
            onRequestDelete={onRequestDelete}
            draggable={draggable}
          />
          <Group
            label={groups.pinned.length > 0 ? t("notesGroup") : null}
            notes={groups.others}
            selectedId={selectedId}
            onSelect={onSelect}
            onRequestDelete={onRequestDelete}
            draggable={draggable}
          />
          {notes.length === 0 && emptyText && (
            <p className="px-3 py-4 text-sm text-ink-muted" data-testid="notes-scope-empty">
              {emptyText}
            </p>
          )}
        </>
      )}
    </div>
  );
}
