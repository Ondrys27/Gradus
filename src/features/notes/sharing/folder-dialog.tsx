"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import {
  FOLDER_COLORS,
  nextFolderPosition,
  parentChoices,
  type FolderColor,
  type FolderItem,
} from "./logic";
import { useCreateFolder, useUpdateFolder } from "./queries";

/** The colour of a folder: a token of the palette, never a hex. */
export const FOLDER_TEXT: Record<FolderColor, string> = {
  violet: "text-violet",
  teal: "text-teal",
  gold: "text-gold",
  green: "text-green",
  orange: "text-orange",
  pink: "text-pink",
};
const FOLDER_FILL: Record<FolderColor, string> = {
  violet: "bg-violet",
  teal: "bg-teal",
  gold: "bg-gold",
  green: "bg-green",
  orange: "bg-orange",
  pink: "bg-pink",
};

export type FolderDialogState =
  | { mode: "new"; parentId: string | null }
  | { mode: "edit"; folder: FolderItem }
  | null;

/** A new folder, or the name, colour and place of one of the account's own. */
export function FolderDialog({
  state,
  folders,
  onClose,
  onCreated,
}: {
  state: FolderDialogState;
  folders: readonly FolderItem[];
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const t = useTranslations("notes.folders");
  const create = useCreateFolder();
  const update = useUpdateFolder();
  const editing = state?.mode === "edit" ? state.folder : null;
  const [name, setName] = useState("");
  const [color, setColor] = useState<FolderColor>("violet");
  const [parentId, setParentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setError(null);
    if (state.mode === "edit") {
      setName(state.folder.name);
      setColor(state.folder.color);
      setParentId(state.folder.parentId);
    } else {
      setName("");
      setColor("violet");
      setParentId(state.parentId);
    }
  }, [state]);

  const parents = parentChoices(folders, editing?.id ?? null);
  const pending = create.isPending || update.isPending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const clean = name.trim().slice(0, 80);
    if (!clean) {
      setError(t("nameRequired"));
      return;
    }
    setError(null);
    try {
      if (editing) {
        const changed = [
          ...(clean !== editing.name ? (["name"] as const) : []),
          ...(color !== editing.color ? (["color"] as const) : []),
          ...(parentId !== editing.parentId ? (["parent"] as const) : []),
        ];
        await update.mutateAsync({ id: editing.id, name: clean, color, parentId, changed });
      } else {
        const id = await create.mutateAsync({
          name: clean,
          color,
          parentId,
          position: nextFolderPosition(folders, parentId),
        });
        onCreated?.(id);
      }
      onClose();
    } catch {
      setError(t("error"));
    }
  }

  return (
    <ResponsiveDialog
      open={!!state}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={editing ? t("editTitle") : t("newTitle")}
      closeLabel={t("cancel")}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="note-folder-dialog">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="note-folder-name">{t("name")}</Label>
          <Input
            id="note-folder-name"
            value={name}
            maxLength={80}
            autoFocus
            placeholder={t("namePlaceholder")}
            onChange={(event) => setName(event.target.value)}
            data-testid="note-folder-name"
          />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-soft">{t("color")}</legend>
          <div className="flex flex-wrap gap-2">
            {FOLDER_COLORS.map((tone) => (
              <button
                key={tone}
                type="button"
                aria-pressed={color === tone}
                aria-label={t(`colorName.${tone}`)}
                onClick={() => setColor(tone)}
                className={cn(
                  "grid size-11 cursor-pointer place-items-center rounded-full border outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-9",
                  color === tone ? "border-ink" : "border-line",
                )}
              >
                <span className={cn("size-5 rounded-full", FOLDER_FILL[tone])} />
              </button>
            ))}
          </div>
        </fieldset>
        {parents.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note-folder-parent">{t("parent")}</Label>
            <select
              id="note-folder-parent"
              className="field cursor-pointer"
              value={parentId ?? ""}
              onChange={(event) => setParentId(event.target.value || null)}
            >
              <option value="">{t("parentNone")}</option>
              {parents.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-pink">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={pending} data-testid="note-folder-save">
            {editing ? t("save") : t("create")}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
