"use client";

import { useState, type FormEvent } from "react";
import { Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import type { IsoDate } from "@/lib/format";
import {
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
  validate,
  workerTaskSchema,
  type WorkerErrorKey,
} from "./logic";
import { useDeleteWorkerTask, useSaveWorkerTask } from "./queries";
import type { WorkerTask } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workerId: string;
  /** Editing this task, or a new one when null. */
  task: WorkerTask | null;
};

/** The owner assigns a task: title, what to do, and by when. */
export function WorkerTaskDialog({ open, onOpenChange, workerId, task }: Props) {
  const t = useTranslations("workers.taskForm");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={task ? t("editTitle") : t("newTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,480px)]"
    >
      <Fields
        key={generation}
        workerId={workerId}
        task={task}
        onDone={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
}

function Fields({
  workerId,
  task,
  onDone,
}: {
  workerId: string;
  task: WorkerTask | null;
  onDone: () => void;
}) {
  const t = useTranslations("workers.taskForm");
  const tErrors = useTranslations("workers.errors");
  const save = useSaveWorkerTask(workerId);
  const remove = useDeleteWorkerTask();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueDate, setDueDate] = useState<IsoDate | null>(task?.due_date ?? null);
  const [errors, setErrors] = useState<Partial<Record<string, WorkerErrorKey>>>({});
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const err = (key: string) => (errors[key] ? tErrors(errors[key]) : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const result = validate(workerTaskSchema, { title, description, due_date: dueDate });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ id: task?.id, input: result.data });
      onDone();
    } catch {
      setFailed(true);
    }
  }

  async function confirmDelete() {
    if (!task) return;
    try {
      await remove.mutateAsync(task.id);
      setConfirming(false);
      onDone();
    } catch {
      // The confirmation shows the error and stays open.
    }
  }

  return (
    <>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField id="worker-task-title" label={t("title")} error={err("title")}>
          <Input
            {...fieldA11y("worker-task-title", err("title"))}
            value={title}
            maxLength={TASK_TITLE_MAX + 10}
            autoFocus
            autoComplete="off"
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <FormField
          id="worker-task-description"
          label={t("description")}
          error={err("description")}
        >
          <Textarea
            {...fieldA11y("worker-task-description", err("description"))}
            value={description}
            rows={3}
            maxLength={TASK_DESCRIPTION_MAX + 10}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <FormField id="worker-task-due" label={t("dueDate")}>
          <DatePicker id="worker-task-due" value={dueDate} onValueChange={setDueDate} />
        </FormField>
        {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {task && (
            <Button
              type="button"
              variant="destructive"
              className="sm:mr-auto"
              onClick={() => setConfirming(true)}
            >
              <Trash2Icon aria-hidden data-icon="inline-start" />
              {t("delete")}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {task ? t("save") : t("create")}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        pending={remove.isPending}
        error={remove.isError ? t("deleteFailed") : null}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
