"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
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
import { useSession } from "@/features/account/queries";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  DEFAULT_DURATION,
  defaultDueAt,
  DESCRIPTION_MAX,
  DURATION_MAX,
  DURATION_PRESETS,
  quickDueAt,
  TITLE_MAX,
  validateTask,
  type QuickDue,
  type TaskErrorKey,
} from "./logic";
import { useAssignees, useCreateTask, useUpdateTask } from "./queries";
import { TargetPicker } from "./target-picker";
import type { CrmTask, TaskOrigin, TaskTarget } from "./types";
import { useAssigneeName } from "./use-assignee-name";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this task; a new one when null. */
  task?: CrmTask | null;
  /** What a new task belongs to; given from a deal or a contact, picked on the Tasks page. */
  target?: TaskTarget;
  origin: TaskOrigin;
};

const QUICK: QuickDue[] = ["today", "tomorrow", "nextWeek"];

/**
 * The same task dialog everywhere: only the title is required. Enter in the
 * title saves the task with tomorrow 9:00, 15 minutes and the person making it.
 */
export function TaskDialog({ open, onOpenChange, task = null, target, origin }: Props) {
  const t = useTranslations("crmTasks.form");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={task ? t("editTitle") : t("newTitle")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,520px)]"
    >
      <Fields
        key={generation}
        task={task}
        target={target}
        origin={origin}
        onDone={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
}

function Fields({
  task,
  target,
  origin,
  onDone,
}: {
  task: CrmTask | null;
  target?: TaskTarget;
  origin: TaskOrigin;
  onDone: () => void;
}) {
  const t = useTranslations("crmTasks.form");
  const tErrors = useTranslations("crmTasks.errors");
  const settings = useFormatSettings();
  const { user } = useSession();
  const assignees = useAssignees();
  const nameOf = useAssigneeName();
  const create = useCreateTask(origin);
  const update = useUpdateTask();

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueAt, setDueAt] = useState<string | null>(
    () => task?.due_at ?? defaultDueAt(new Date(), settings.timeZone),
  );
  const [duration, setDuration] = useState<number>(task?.duration_minutes ?? DEFAULT_DURATION);
  const [custom, setCustom] = useState(
    () => task !== null && !(DURATION_PRESETS as readonly number[]).includes(task.duration_minutes),
  );
  const [customText, setCustomText] = useState(custom ? String(duration) : "");
  const [assignee, setAssignee] = useState<string>(task?.assignee_id ?? user.id);
  const [chosenTarget, setChosenTarget] = useState<TaskTarget>(() =>
    task ? { deal: task.deal, contact: task.contact } : (target ?? { deal: null, contact: null }),
  );
  const [errors, setErrors] = useState<Partial<Record<string, TaskErrorKey>>>({});
  const [failed, setFailed] = useState(false);
  const locked = !task && origin !== "tasks";
  const err = (key: string) => (errors[key] ? tErrors(errors[key]) : undefined);

  const people = useMemo(() => {
    const list = (assignees.data ?? []).map((person) => ({
      value: person.userId,
      label: nameOf(person.userId),
    }));
    // The current choice stays offered even when the person left the space.
    if (!list.some((item) => item.value === assignee)) {
      list.push({ value: assignee, label: nameOf(assignee) });
    }
    return list;
  }, [assignees.data, assignee, nameOf]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const minutes = custom ? Number(customText) : duration;
    const result = validateTask({
      title,
      description,
      due_at: dueAt ?? "",
      duration_minutes: Number.isFinite(minutes) ? minutes : NaN,
      assignee_id: assignee,
      // A deal that vanished from view keeps its link; only the ids are saved.
      deal_id: chosenTarget.deal?.id ?? (task && !task.deal ? task.deal_id : null),
      contact_id: chosenTarget.contact?.id ?? (task && !task.contact ? task.contact_id : null),
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      if (task) await update.mutateAsync({ id: task.id, input: result.data });
      else await create.mutateAsync(result.data);
      onDone();
    } catch {
      setFailed(true);
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormField id="crm-task-title" label={t("title")} error={err("title")} hint={t("titleHint")}>
        <Input
          {...fieldA11y("crm-task-title", err("title"), true)}
          value={title}
          maxLength={TITLE_MAX + 10}
          autoFocus
          autoComplete="off"
          placeholder={t("titlePlaceholder")}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>

      <FormField id="crm-task-target" label={t("target")} error={err("target")}>
        <TargetPicker
          id="crm-task-target"
          value={chosenTarget}
          locked={locked}
          invalid={Boolean(err("target"))}
          describedBy={err("target") ? "crm-task-target-message" : undefined}
          placeholder={t("targetPlaceholder")}
          onChange={setChosenTarget}
        />
      </FormField>

      <FormField id="crm-task-due" label={t("due")} error={err("due_at")}>
        <div className="flex flex-col gap-2">
          <DateTimePicker
            id="crm-task-due"
            value={dueAt}
            onValueChange={setDueAt}
            timeLabel={t("time")}
            invalid={Boolean(err("due_at"))}
          />
          <div role="group" aria-label={t("quickLabel")} className="flex flex-wrap gap-1.5">
            {QUICK.map((quick) => (
              <Button
                key={quick}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDueAt(quickDueAt(quick, dueAt, new Date(), settings.timeZone))}
              >
                {t(`quick.${quick}`)}
              </Button>
            ))}
          </div>
        </div>
      </FormField>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink-soft">{t("duration")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {DURATION_PRESETS.map((minutes) => (
            <DurationButton
              key={minutes}
              pressed={!custom && duration === minutes}
              onClick={() => {
                setCustom(false);
                setDuration(minutes);
              }}
            >
              {t("minutes", { count: formatNumber(minutes, {}, settings) })}
            </DurationButton>
          ))}
          <DurationButton pressed={custom} onClick={() => setCustom(true)}>
            {t("custom")}
          </DurationButton>
        </div>
        {custom && (
          <FormField
            id="crm-task-minutes"
            label={t("customMinutes")}
            error={err("duration_minutes")}
          >
            <Input
              {...fieldA11y("crm-task-minutes", err("duration_minutes"))}
              type="number"
              inputMode="numeric"
              min={1}
              max={DURATION_MAX}
              value={customText}
              className="w-32"
              onChange={(event) => setCustomText(event.target.value)}
            />
          </FormField>
        )}
      </fieldset>

      <FormField id="crm-task-assignee" label={t("assignee")}>
        <Select
          value={assignee}
          items={people}
          onValueChange={(next) => {
            if (typeof next === "string") setAssignee(next);
          }}
        >
          <SelectTrigger id="crm-task-assignee">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {people.map((person) => (
              <SelectItem key={person.value} value={person.value}>
                {person.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField id="crm-task-description" label={t("description")} error={err("description")}>
        <Textarea
          {...fieldA11y("crm-task-description", err("description"))}
          value={description}
          rows={3}
          maxLength={DESCRIPTION_MAX + 10}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>

      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {task ? t("save") : t("create")}
        </Button>
      </div>
    </form>
  );
}

function DurationButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 min-w-16 cursor-pointer items-center justify-center rounded-full border px-3.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-9",
        pressed
          ? "border-violet/60 bg-violet/15 text-ink"
          : "border-line text-ink-soft hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
