"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import type { NoteKind } from "./map-doc";

type Props = {
  /** What the note would become; null = closed. */
  to: NoteKind | null;
  onClose: () => void;
  onConvert: (how: "replace" | "new") => void;
};

/**
 * Turning a note into the other kind. In place it can not be undone (the
 * other kind keeps less), so it asks; a new note keeps the original as it is.
 */
export function ConvertDialog({ to, onClose, onConvert }: Props) {
  const t = useTranslations("notes.map.convert");
  const kind = to ?? "mindmap";
  return (
    <ResponsiveDialog
      open={to !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t(`${kind}.title`)}
      closeLabel={t("cancel")}
    >
      <div className="flex flex-col gap-5" data-testid="note-convert">
        <p className="text-sm text-ink-soft">{t(`${kind}.text`)}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="button" variant="outline" onClick={() => onConvert("new")} data-testid="note-convert-new">
            {t("asNew")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => onConvert("replace")}
            data-testid="note-convert-replace"
          >
            {t(`${kind}.replace`)}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
