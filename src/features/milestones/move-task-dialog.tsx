"use client";

import { useMemo, useState, type FormEvent } from "react";
import { FlagIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  buildTree,
  flattenTree,
  MAX_TASK_LEVELS,
  planMove,
  siblingsOf,
  subtreeIds,
  type MoveTarget,
} from "./task-tree";
import type { Task } from "./types";
import { useFreshOnOpen } from "./use-fresh-on-open";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  milestoneTitle: string;
  tasks: Task[];
  /** The task to move; kept while the dialog closes. */
  task: Task | null;
  onMove: (taskId: string, target: MoveTarget) => void;
};

/** The value of the milestone itself (level 1) among the parents. */
const ROOT = "root";

/**
 * "Move…" from the menu of a row: the same moves as dragging, without a
 * pointer. A tree of every place the task can go under (the milestone for
 * level 1), then where among the new siblings. The own subtree is not offered;
 * a parent the rules refuse (too deep) is shown but cannot be picked.
 */
export function MoveTaskDialog({ open, onOpenChange, milestoneTitle, tasks, task, onMove }: Props) {
  const t = useTranslations("milestones.tasks");
  const generation = useFreshOnOpen(open);
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={task ? t("moveDialog.title", { title: task.title }) : ""}
      closeLabel={t("form.close")}
    >
      {task && (
        <MoveFields
          key={generation}
          milestoneTitle={milestoneTitle}
          tasks={tasks}
          task={task}
          onMove={(target) => {
            onMove(task.id, target);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      )}
    </ResponsiveDialog>
  );
}

function MoveFields({
  milestoneTitle,
  tasks,
  task,
  onMove,
  onCancel,
}: {
  milestoneTitle: string;
  tasks: Task[];
  task: Task;
  onMove: (target: MoveTarget) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("milestones.tasks");
  const [parentId, setParentId] = useState<string | null>(task.parent_task_id);
  const [index, setIndex] = useState<number>(() =>
    siblingsOf(tasks, task.parent_task_id).findIndex((item) => item.id === task.id),
  );

  const parents = useMemo(() => {
    const own = subtreeIds(tasks, task.id);
    return flattenTree(buildTree(tasks), new Set())
      .filter((row) => !own.has(row.task.id))
      .map((row) => ({
        id: row.task.id,
        title: row.task.title,
        depth: row.depth + 1,
        allowed: planMove(tasks, task.id, { parentId: row.task.id, index: 0 }).ok,
      }));
  }, [tasks, task.id]);

  const siblings = siblingsOf(tasks, parentId).filter((item) => item.id !== task.id);
  const positions = [
    { value: "0", label: t("moveDialog.first") },
    ...siblings.map((sibling, at) => ({
      value: String(at + 1),
      label: t("moveDialog.after", { title: sibling.title }),
    })),
  ];
  const target: MoveTarget = { parentId, index: Math.min(index, siblings.length) };
  const plan = planMove(tasks, task.id, target);

  function pickParent(next: string | null) {
    setParentId(next);
    // Back under the parent it has: its own place; anywhere else: the end.
    setIndex(
      next === task.parent_task_id
        ? siblingsOf(tasks, next).findIndex((item) => item.id === task.id)
        : siblingsOf(tasks, next).filter((item) => item.id !== task.id).length,
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (plan.ok && plan.changed) onMove(target);
  }

  const optionClass =
    "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg pr-3 text-[15px] text-ink-soft transition-colors hover:bg-surface-hover has-checked:bg-surface-hover has-checked:text-ink has-checked:ring-1 has-checked:ring-violet/60 has-focus-visible:ring-3 has-focus-visible:ring-violet/40 has-disabled:cursor-not-allowed has-disabled:opacity-45 motion-reduce:transition-none mouse:min-h-9";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="move-task-form">
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink-soft">{t("moveDialog.parent")}</legend>
        <div className="-mx-1 flex max-h-[min(40dvh,320px)] flex-col gap-0.5 overflow-y-auto px-1 py-1">
          <label className={cn(optionClass, "pl-3")}>
            <input
              type="radio"
              name="move-parent"
              className="sr-only"
              checked={parentId === null}
              onChange={() => pickParent(null)}
              value={ROOT}
            />
            <FlagIcon aria-hidden className="size-4 shrink-0 text-violet" />
            <span className="min-w-0 flex-1 truncate">
              {t("moveDialog.root", { title: milestoneTitle })}
            </span>
          </label>
          {parents.map((option) => (
            <label
              key={option.id}
              className={optionClass}
              style={{ paddingLeft: 12 + Math.min(option.depth, 12) * 16 }}
              title={option.allowed ? undefined : t("errors.tooDeep", { max: MAX_TASK_LEVELS })}
            >
              <input
                type="radio"
                name="move-parent"
                className="sr-only"
                checked={parentId === option.id}
                disabled={!option.allowed}
                onChange={() => pickParent(option.id)}
                value={option.id}
              />
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ink-muted" />
              <span className="min-w-0 flex-1 truncate">{option.title}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {siblings.length > 0 && (
        <div className="flex flex-col gap-2">
          <label id="move-position-label" className="text-sm font-medium text-ink-soft">
            {t("moveDialog.position")}
          </label>
          <Select
            value={String(target.index)}
            items={positions}
            onValueChange={(next) => {
              const value = Number(next);
              if (Number.isInteger(value)) setIndex(value);
            }}
          >
            <SelectTrigger aria-labelledby="move-position-label" data-testid="move-position">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {positions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("moveDialog.cancel")}
        </Button>
        <Button type="submit" disabled={!plan.ok || !plan.changed}>
          {t("moveDialog.submit")}
        </Button>
      </div>
    </form>
  );
}
