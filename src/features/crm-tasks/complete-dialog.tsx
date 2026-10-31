"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { NOTE_MAX } from "./logic";
import { useCompleteTask } from "./queries";
import type { CrmTask } from "./types";

/**
 * Ticking a task off, in one step: an optional note of how it went, saved with
 * it and shown in the history of the deal and the contact. ⌘/Ctrl+Enter saves.
 */
export function CompleteTaskDialog({
  task,
  onClose,
  onDone,
}: {
  task: CrmTask | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const t = useTranslations("crmTasks.complete");
  const generation = useFreshOnOpen(task !== null);
  // Keep the last task on screen while the dialog closes.
  const [shown, setShown] = useState<CrmTask | null>(task);
  if (task && task !== shown) setShown(task);
  const current = task ?? shown;
  return (
    <ResponsiveDialog
      open={task !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("title")}
      closeLabel={t("close")}
    >
      {current && (
        <NoteForm
          key={generation}
          task={current}
          onCancel={onClose}
          onSaved={() => {
            onClose();
            onDone?.();
          }}
        />
      )}
    </ResponsiveDialog>
  );
}

function NoteForm({
  task,
  onCancel,
  onSaved,
}: {
  task: CrmTask;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("crmTasks.complete");
  const complete = useCompleteTask();
  const [note, setNote] = useState("");

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    try {
      await complete.mutateAsync({ task, note: note.slice(0, NOTE_MAX) });
      onSaved();
    } catch {
      // The alert below says so; the note stays to try again.
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
        {t("lead", { title: task.title })}
      </p>
      <FormField id="crm-task-note" label={t("note")} hint={t("hint")}>
        <Textarea
          id="crm-task-note"
          aria-describedby="crm-task-note-message"
          value={note}
          rows={3}
          autoFocus
          maxLength={NOTE_MAX}
          placeholder={t("placeholder")}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
          }}
        />
      </FormField>
      {complete.isError && <FormAlert>{t("failed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={complete.isPending}>
          {t("confirm")}
        </Button>
      </div>
    </form>
  );
}
