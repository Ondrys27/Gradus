"use client";

import { useMemo, useState } from "react";
import { PinIcon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEditedAt } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { orderBySearch } from "./notes-logic";
import { useNotes, useNoteSearch } from "./queries";

type Props = {
  /** Notes already tied to the target, left out of the choice. */
  excludeIds?: readonly string[];
  onPick: (noteId: string) => void;
  disabled?: boolean;
  /** Names the list for screen readers and tests. */
  label: string;
  className?: string;
};

/**
 * Choosing one of the user's notes: the newest ones, or the best matches of
 * what is typed (full text, without diacritics), one tap each.
 */
export function NotePicker({ excludeIds = [], onPick, disabled, label, className }: Props) {
  const t = useTranslations("notes");
  const settings = useFormatSettings();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 250);
  const notes = useNotes();
  const search = useNoteSearch(debounced);

  const shown = useMemo(() => {
    const all = notes.data ?? [];
    const list =
      debounced.length >= 2
        ? orderBySearch(
            all,
            (search.data ?? []).map((hit) => hit.id),
          )
        : all;
    const excluded = new Set(excludeIds);
    return list.filter((note) => !excluded.has(note.id)).slice(0, 30);
  }, [debounced, excludeIds, notes.data, search.data]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          // Inside a form (the task dialog) Enter must not submit it.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          placeholder={t("searchPlaceholder")}
          aria-label={t("picker.search")}
          className="!pl-10 [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      {!notes.data ? (
        <div className="flex flex-col gap-2 p-2" aria-hidden>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : shown.length === 0 ? (
        <p className="px-2 py-3 text-sm text-ink-muted">
          {debounced.length >= 2
            ? search.isFetching
              ? t("searching")
              : t("noResults", { query: debounced })
            : t("picker.empty")}
        </p>
      ) : (
        <ul aria-label={label} className="flex max-h-64 flex-col gap-0.5 overflow-y-auto overscroll-contain">
          {shown.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(note.id)}
                data-testid="note-pick"
                className="flex min-h-11 w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5">
                  {note.pinned && <PinIcon aria-hidden className="size-3 shrink-0 text-gold" />}
                  <span className={cn("truncate font-semibold", note.title ? "text-ink" : "text-ink-muted")}>
                    {note.title || t("untitled")}
                  </span>
                </span>
                <span className="truncate text-xs text-ink-muted">
                  {formatEditedAt(new Date(note.updated_at), settings)}
                  {note.preview ? ` · ${note.preview}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
