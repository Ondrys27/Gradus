"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useTaskNoteTemplates } from "@/features/notes/link-queries";
import { WorkNotes } from "@/features/notes/work-notes";
import { RewardPriceField, useRewardPrice } from "@/features/workers/rewards/reward-price-field";
import { useCreateTask, useUpdateTask } from "./queries";
import {
  DESCRIPTION_MAX,
  fieldErrors,
  taskSchema,
  TITLE_MAX,
  type MilestoneErrorKey,
} from "./schemas";
import { TaskStatusSwitch } from "./task-status-ui";
import { openSubtasks } from "./task-tree";
import type { Task, TaskStatus } from "./types";
import { useFreshOnOpen } from "./use-fresh-on-open";

export type TaskFormMode = { kind: "create"; parent: Task | null } | { kind: "edit"; task: Task };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  milestoneId: string;
  tasks: Task[];
  mode: TaskFormMode;
};

export function TaskFormDialog({ open, onOpenChange, milestoneId, tasks, mode }: Props) {
  const t = useTranslations("milestones.tasks.form");
  const generation = useFreshOnOpen(open);
  const title =
    mode.kind === "edit"
      ? t("editTitle")
      : mode.parent
        ? t("createSubtaskTitle", { parent: mode.parent.title })
        : t("createTitle");

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title} closeLabel={t("close")}>
      <TaskFields
        key={generation}
        milestoneId={milestoneId}
        tasks={tasks}
        mode={mode}
        onDone={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
}

function TaskFields({
  milestoneId,
  tasks,
  mode,
  onDone,
}: {
  milestoneId: string;
  tasks: Task[];
  mode: TaskFormMode;
  onDone: () => void;
}) {
  const t = useTranslations("milestones");
  const tPrice = useTranslations("workers.rewardPrice");
  const create = useCreateTask(milestoneId);
  const update = useUpdateTask(milestoneId);
  const editing = mode.kind === "edit" ? mode.task : null;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(editing?.status ?? "todo");
  const [dueDate, setDueDate] = useState<string | null>(editing?.due_date ?? null);
  const [errors, setErrors] = useState<Partial<Record<string, MilestoneErrorKey>>>({});
  const [failed, setFailed] = useState(false);
  // The reward for completion (28.2): whoever of the workers ticks the task off gets it.
  const price = useRewardPrice(
    { kind: "task" },
    editing ? { amount: editing.reward_amount ?? null, currency: editing.reward_currency ?? null } : null,
  );
  const [savedId, setSavedId] = useState<string | null>(null);
  const [priceFailed, setPriceFailed] = useState(false);
  const pending = create.isPending || update.isPending;
  const locked = editing ? openSubtasks(tasks, editing.id) > 0 : false;
  const noteTemplates = useTaskNoteTemplates(milestoneId, !!editing);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const parsed = taskSchema.safeParse({ title, description, status, due_date: dueDate });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    if (price.invalid) return;
    setErrors({});
    setPriceFailed(false);
    let id = editing?.id ?? savedId;
    try {
      if (id) {
        await update.mutateAsync({ id, input: parsed.data });
      } else {
        const row = await create.mutateAsync({
          parentId: mode.kind === "create" ? (mode.parent?.id ?? null) : null,
          input: parsed.data,
        });
        id = row.id;
        setSavedId(id);
      }
    } catch {
      setFailed(true);
      return;
    }
    try {
      await price.commit("task", id);
      onDone();
    } catch {
      setPriceFailed(true);
    }
  }

  const titleError = errors.title && t(`errors.${errors.title}`);
  const descriptionError = errors.description && t(`errors.${errors.description}`);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField id="task-title" label={t("tasks.form.name")} error={titleError}>
        <Input
          {...fieldA11y("task-title", titleError)}
          value={title}
          maxLength={TITLE_MAX + 20}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
      <FormField id="task-description" label={t("tasks.form.description")} error={descriptionError}>
        <Textarea
          {...fieldA11y("task-description", descriptionError)}
          value={description}
          maxLength={DESCRIPTION_MAX + 100}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      <FormField
        id="task-status"
        label={t("tasks.form.status")}
        hint={locked ? t("tasks.form.statusLocked") : undefined}
      >
        <TaskStatusSwitch id="task-status" value={status} locked={locked} onChange={setStatus} />
      </FormField>
      <FormField id="task-due" label={t("tasks.form.dueDate")}>
        <DatePicker
          id="task-due"
          value={dueDate}
          onValueChange={setDueDate}
          placeholder={t("tasks.form.dueDatePlaceholder")}
        />
      </FormField>
      <RewardPriceField state={price} id="task-reward" />
      {editing && (
        <WorkNotes
          target={{ kind: "task", id: editing.id, milestoneId }}
          title={editing.title}
          template={noteTemplates.data?.[editing.id] ?? null}
          onOpenNote={onDone}
          className="border-t border-line pt-4"
        />
      )}
      {failed && <FormAlert>{t("tasks.errors.saveFailed")}</FormAlert>}
      {priceFailed && <FormAlert>{tPrice("saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("tasks.form.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {editing ? t("tasks.form.save") : t("tasks.form.create")}
        </Button>
      </div>
    </form>
  );
}
