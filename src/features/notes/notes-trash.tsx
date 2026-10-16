"use client";

import { ChevronLeftIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { daysLeftInTrash } from "./notes-logic";
import { useNotesTrash, useRestoreNote } from "./queries";

type Props = {
  readOnly: boolean;
  onClose: () => void;
  onRestored: (id: string) => void;
};

/** Recently Deleted: what can still come back, and for how long. */
export function NotesTrash({ readOnly, onClose, onRestored }: Props) {
  const t = useTranslations("notes");
  const trash = useNotesTrash(true);
  const restore = useRestoreNote();

  return (
    <div className="flex flex-col gap-2" data-testid="notes-trash">
      <button
        type="button"
        onClick={onClose}
        className="flex min-h-11 items-center gap-1 self-start rounded-xl pr-3 text-sm font-semibold text-violet"
      >
        <ChevronLeftIcon className="size-4" />
        {t("trash.close")}
      </button>
      <div className="px-3">
        <h2 className="text-lg font-semibold text-ink">{t("trash.title")}</h2>
        <p className="text-sm text-ink-muted">{t("trash.hint")}</p>
      </div>
      {!trash.data ? (
        <div className="flex flex-col gap-3 px-3 py-3" aria-hidden>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : trash.data.length === 0 ? (
        <p className="px-3 py-4 text-sm text-ink-muted">{t("trash.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {trash.data.map((note) => (
            <li
              key={note.id}
              data-testid="trash-row"
              className="flex min-h-14 items-center gap-2 rounded-xl px-3 py-2"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold text-ink-soft">
                  {note.title || t("untitled")}
                </span>
                <span className="text-sm text-ink-muted">
                  {t("trash.daysLeft", { days: daysLeftInTrash(note.deleted_at) })}
                </span>
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() =>
                    restore.mutate(note.id, { onSuccess: () => onRestored(note.id) })
                  }
                  className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-violet hover:bg-violet/10"
                >
                  <RotateCcwIcon className="size-4" />
                  {t("trash.restore")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
