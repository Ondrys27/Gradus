"use client";

import { useTranslations } from "next-intl";
import { useNotes } from "@/features/notes/queries";
import { cn } from "@/lib/utils";
import type { CustomSettingProps } from "@/features/widgets/system";

/** The app's own kind of widget setting: one of the person's pinned notes, or the newest. */
export function NoteSettingField({ label, value, onChange }: CustomSettingProps) {
  const t = useTranslations("dashboard.widgets.pinnedNote");
  const notes = useNotes();
  const selected = typeof value === "string" ? value : null;
  const pinned = (notes.data ?? []).filter((note) => note.pinned || note.id === selected);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-ink">{label}</legend>
      <ul className="flex flex-col gap-1">
        {[
          { id: null, title: t("settings.note.auto") },
          ...pinned.map((note) => ({ id: note.id, title: note.title || t("untitled") })),
        ].map((option) => (
          <li key={option.id ?? "auto"}>
            <button
              type="button"
              aria-pressed={selected === option.id}
              onClick={() => onChange(option.id)}
              className={cn(
                "flex min-h-11 w-full items-center rounded-xl border px-3 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9",
                selected === option.id
                  ? "border-violet bg-violet/20 text-ink"
                  : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
              )}
            >
              <span className="truncate">{option.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {pinned.length === 0 && <p className="text-xs text-ink-muted">{t("settings.note.none")}</p>}
    </fieldset>
  );
}
