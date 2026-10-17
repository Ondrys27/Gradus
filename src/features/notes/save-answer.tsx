"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckIcon, NotebookPenIcon, SquarePenIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import { formatCalendarDate, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { blocksFromPlainText, docWithTitle, draftFromDoc } from "./document";
import { useNotesInWork } from "./link-queries";
import { NotePicker } from "./note-picker";
import { getNoteSaver, useAppendToNote, useCreateNote } from "./queries";
import { useSession } from "@/features/account/queries";
import { noteHref } from "./work-notes";

/**
 * "Save to notes" under one of Jarvis's answers: as a new note, or added to
 * the end of an existing one. Nothing reaches the notes without this click;
 * Jarvis never writes there on his own.
 */
export function SaveAnswerToNotes({ text }: { text: string }) {
  const t = useTranslations("notes.fromJarvis");
  const settings = useFormatSettings();
  const { user } = useSession();
  const { allowed, readOnly } = useNotesInWork();
  const createNote = useCreateNote();
  const append = useAppendToNote();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!allowed || readOnly || !text.trim()) return null;
  const heading = t("heading", { date: formatCalendarDate(todayIsoDate(settings), settings) });

  async function saveNew() {
    setBusy(true);
    setFailed(false);
    try {
      const id = createNote({
        draft: draftFromDoc(docWithTitle(heading, blocksFromPlainText(text))),
        where: "jarvis",
      });
      const saver = getNoteSaver(user.id);
      await saver.flush(id);
      if (saver.unsavedDraft(id)) throw new Error("note_not_saved");
      track("note_saved_from_jarvis", { mode: "new" });
      setSaved(id);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function addTo(id: string) {
    setFailed(false);
    append.mutate(
      { id, heading, blocks: blocksFromPlainText(text) },
      {
        onSuccess: () => {
          track("note_saved_from_jarvis", { mode: "append" });
          setSaved(id);
          setOpen(false);
        },
        onError: () => setFailed(true),
      },
    );
  }

  if (saved) {
    return (
      <p role="status" className="flex items-center gap-1.5 pl-2 text-xs text-green">
        <CheckIcon aria-hidden className="size-3.5" />
        {t("saved")}
        <Link href={noteHref(saved)} className="font-semibold text-violet underline-offset-2 hover:underline">
          {t("open")}
        </Link>
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t("save")}
        title={t("save")}
        data-testid="jarvis-save-note"
        className={cn(
          "grid size-9 place-items-center rounded-full outline-none transition-colors hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-teal/50 mouse:size-7",
          open ? "text-violet" : "text-ink-muted",
        )}
      >
        <NotebookPenIcon aria-hidden className="size-3.5" />
      </button>
      {open && (
        <div className="mt-1 flex basis-full flex-col gap-2 rounded-2xl border border-line bg-canvas p-2">
          <Button
            type="button"
            size="sm"
            disabled={busy || append.isPending}
            onClick={() => void saveNew()}
            className="self-start"
            data-testid="jarvis-save-new-note"
          >
            <SquarePenIcon aria-hidden data-icon="inline-start" />
            {t("newNote")}
          </Button>
          <p className="px-1 text-xs text-ink-muted">{t("orAppend")}</p>
          <NotePicker
            label={t("pickLabel")}
            disabled={busy || append.isPending}
            onPick={addTo}
          />
        </div>
      )}
      {failed && (
        <p role="alert" className="basis-full pl-1 text-xs text-pink">
          {t("failed")}
        </p>
      )}
    </>
  );
}
