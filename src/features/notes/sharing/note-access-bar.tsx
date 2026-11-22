"use client";

import { LockIcon, UsersRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { accessLabel, visibleFaces } from "./logic";
import { useNotePeople } from "./queries";

/**
 * The header of an open note: the faces of the people who reach it and a
 * label "Private" or "Shared (n)"; a click opens the share dialog.
 */
export function NoteAccessBar({
  noteId,
  shared,
  onOpen,
  className,
}: {
  noteId: string;
  /** What the list knows before the people load. */
  shared: boolean;
  onOpen: () => void;
  className?: string;
}) {
  const t = useTranslations("notes.sharing");
  const people = useNotePeople({ kind: "note", id: noteId });
  const list = people.data ?? [];
  const label = people.data ? accessLabel(list) : { shared, count: 0 };
  const { faces, more } = visibleFaces(label.shared ? list : [], 4);

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="note-access"
      data-shared={label.shared ? "true" : "false"}
      title={t("accessLabel", { count: label.count })}
      className={cn(
        "flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-2 text-xs font-medium outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-8",
        className,
      )}
    >
      {faces.length > 0 && (
        <span className="flex -space-x-2" aria-hidden>
          {faces.map((person) => (
            <Avatar
              key={person.userId}
              src={person.avatarUrl}
              name={person.name}
              className="size-6 border-canvas text-[10px] ring-2 ring-canvas"
            />
          ))}
          {more > 0 && (
            <span className="grid size-6 place-items-center rounded-full bg-surface text-[10px] text-ink-soft ring-2 ring-canvas">
              +{more}
            </span>
          )}
        </span>
      )}
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
          label.shared ? "bg-teal/14 text-teal" : "bg-surface text-ink-muted",
        )}
      >
        {label.shared ? (
          <UsersRoundIcon aria-hidden className="size-3.5" />
        ) : (
          <LockIcon aria-hidden className="size-3.5" />
        )}
        {label.shared ? t("shared", { count: label.count }) : t("private")}
      </span>
    </button>
  );
}
