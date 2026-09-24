"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { ListChecksIcon, ListTreeIcon, NetworkIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCreateTask, useDeleteTask, useReorderTasks, useSetTaskStatus } from "./queries";
import { TITLE_MAX } from "./schemas";
import { TaskFormDialog, type TaskFormMode } from "./task-form-dialog";
import { TaskMap } from "./task-map";
import { TaskGroup, type TaskHandlers } from "./task-row";
import { buildTree, openSubtasks, reorderSiblings } from "./task-tree";
import { useTaskView, type TaskView } from "./task-view-preference";
import type { Milestone, Task } from "./types";

type TaskFormState = { open: boolean; mode: TaskFormMode };

/** The tasks of one milestone as a sortable list or a map, with quick add and task dialogs. */
export function TasksPanel({ milestone, tasks }: { milestone: Milestone; tasks: Task[] }) {
  const t = useTranslations("milestones.tasks");
  const milestoneId = milestone.id;
  const [view, setView] = useTaskView();
  const setStatus = useSetTaskStatus(milestoneId);
  const create = useCreateTask(milestoneId);
  const remove = useDeleteTask(milestoneId);
  const reorder = useReorderTasks(milestoneId);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormState>({
    open: false,
    mode: { kind: "create", parent: null },
  });
  const [deleting, setDeleting] = useState<{ task: Task; open: boolean } | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const quickRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => buildTree(tasks), [tasks]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function report(cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : String((cause as { message?: string })?.message);
    setError(
      message.includes("task_has_open_subtasks")
        ? t("errors.openSubtasks")
        : t("errors.saveFailed"),
    );
  }

  const handlers: TaskHandlers = {
    tasks,
    collapsed,
    onToggleCollapsed: (id) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    onToggleDone: (task) => {
      const status = task.status === "done" ? "todo" : "done";
      if (status === "done" && openSubtasks(tasks, task.id) > 0) return;
      setError(null);
      setStatus.mutate({ id: task.id, status }, { onError: report });
    },
    onAddSubtask: (task) => setForm({ open: true, mode: { kind: "create", parent: task } }),
    onEdit: (task) => setForm({ open: true, mode: { kind: "edit", task } }),
    onDelete: (task) => {
      if (tasks.some((other) => other.parent_task_id === task.id)) {
        setDeleting({ task, open: true });
      } else {
        setError(null);
        remove.mutate(task.id, { onError: report });
      }
    },
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const { changes } = reorderSiblings(tasks, activeId, overId);
    if (changes.length === 0) return;
    setError(null);
    reorder.mutate({ activeId, overId, changes }, { onError: report });
  }

  function quickAdd(event: FormEvent) {
    event.preventDefault();
    const title = quickTitle.trim().slice(0, TITLE_MAX);
    if (!title) return;
    setError(null);
    setQuickTitle("");
    create.mutate(
      { parentId: null, input: { title, description: "", status: "todo", due_date: null } },
      { onError: report },
    );
    quickRef.current?.focus();
  }

  return (
    <GlowCard interactive={false} className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="micro-label">{t("heading")}</h2>
        <ViewSwitch view={view} onChange={setView} />
      </div>

      {error && <FormAlert>{error}</FormAlert>}

      {view === "map" ? (
        <TaskMap
          milestone={milestone}
          tasks={tasks}
          onOpen={handlers.onEdit}
          onToggleDone={handlers.onToggleDone}
          onAddChild={(parent) => setForm({ open: true, mode: { kind: "create", parent } })}
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<ListChecksIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Button variant="outline" onClick={() => quickRef.current?.focus()}>
              {t("emptyAction")}
            </Button>
          }
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <TaskGroup nodes={tree} handlers={handlers} />
        </DndContext>
      )}

      <form onSubmit={quickAdd} className="flex items-center gap-2">
        <Input
          ref={quickRef}
          value={quickTitle}
          maxLength={TITLE_MAX}
          aria-label={t("addLabel")}
          placeholder={t("addPlaceholder")}
          onChange={(event) => setQuickTitle(event.target.value)}
        />
        <Button type="submit" size="icon" variant="outline" aria-label={t("addButton")}>
          <PlusIcon aria-hidden />
        </Button>
      </form>

      <TaskFormDialog
        open={form.open}
        onOpenChange={(open) => setForm((current) => ({ ...current, open }))}
        milestoneId={milestoneId}
        tasks={tasks}
        mode={form.mode}
      />

      {deleting && (
        <ConfirmDialog
          open={deleting.open}
          onOpenChange={(open) => setDeleting((current) => current && { ...current, open })}
          title={t("delete.title")}
          description={t("delete.description", {
            title: deleting.task.title,
            count: tasks.filter((task) => task.parent_task_id === deleting.task.id).length,
          })}
          confirmLabel={t("delete.confirm")}
          cancelLabel={t("delete.cancel")}
          closeLabel={t("form.close")}
          onConfirm={() => {
            setError(null);
            remove.mutate(deleting.task.id, { onError: report });
            setDeleting({ ...deleting, open: false });
          }}
        />
      )}
    </GlowCard>
  );
}

function ViewSwitch({ view, onChange }: { view: TaskView; onChange: (view: TaskView) => void }) {
  const t = useTranslations("milestones.tasks.view");
  const options = [
    { value: "list", icon: ListTreeIcon },
    { value: "map", icon: NetworkIcon },
  ] as const;

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="flex rounded-xl border border-line bg-canvas-deep/40 p-0.5"
    >
      {options.map(({ value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => onChange(value)}
          className={cn(
            "flex h-10 cursor-pointer items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium text-ink-muted transition-colors outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8",
            view === value && "bg-surface-hover text-ink shadow-glow",
          )}
        >
          <Icon aria-hidden className="size-4" />
          {t(value)}
        </button>
      ))}
    </div>
  );
}
