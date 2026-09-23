"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FormAlert } from "@/components/ui/form-alert";
import { fieldA11y, FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateTask, useUpdateTask } from "./queries";
import {
  DESCRIPTION_MAX,
  fieldErrors,
  taskSchema,
  TITLE_MAX,
  type MilestoneErrorKey,
} from "./schemas";
import { openSubtasks } from "./task-tree";
import type { Task, TaskStatus } from "./types";
import { useFreshOnOpen } from "./use-fresh-on-open";

export type TaskFormMode = { kind: "create"; parent: Task | null } | { kind: "edit"; task: Task };

const STATUSES: TaskStatus[] = ["todo", "in_progress", "done"];

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
  const create = useCreateTask(milestoneId);
  const update = useUpdateTask(milestoneId);
  const editing = mode.kind === "edit" ? mode.task : null;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(editing?.status ?? "todo");
  const [dueDate, setDueDate] = useState<string | null>(editing?.due_date ?? null);
  const [errors, setErrors] = useState<Partial<Record<string, MilestoneErrorKey>>>({});
  const [failed, setFailed] = useState(false);
  const pending = create.isPending || update.isPending;
  const locked = editing ? openSubtasks(tasks, editing.id) > 0 : false;

  const statuses = useMemo(
    () => STATUSES.map((value) => ({ value, label: t(`tasks.status.${value}`) })),
    [t],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const parsed = taskSchema.safeParse({ title, description, status, due_date: dueDate });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, input: parsed.data });
      } else {
        await create.mutateAsync({
          parentId: mode.kind === "create" ? (mode.parent?.id ?? null) : null,
          input: parsed.data,
        });
      }
      onDone();
    } catch {
      setFailed(true);
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
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="task-status"
          label={t("tasks.form.status")}
          hint={locked ? t("tasks.form.statusLocked") : undefined}
        >
          <Select
            value={status}
            items={statuses}
            onValueChange={(next) => {
              if (next === "todo" || next === "in_progress" || next === "done") setStatus(next);
            }}
          >
            <SelectTrigger id="task-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={locked && option.value === "done"}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="task-due" label={t("tasks.form.dueDate")}>
          <DatePicker
            id="task-due"
            value={dueDate}
            onValueChange={setDueDate}
            placeholder={t("tasks.form.dueDatePlaceholder")}
          />
        </FormField>
      </div>
      {failed && <FormAlert>{t("tasks.errors.saveFailed")}</FormAlert>}
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
