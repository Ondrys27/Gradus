"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ListChecksIcon, ListTreeIcon, NetworkIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCan } from "@/features/account/workspace-queries";
import { useAwardXp } from "@/features/game/queries";
import { useNotesInWork, useTaskNoteTemplates } from "@/features/notes/link-queries";
import { useWriteAndOpen } from "@/features/notes/work-notes";
import {
  MoveTaskError,
  useCreateTask,
  useDeleteTask,
  useMoveTask,
  useSetTaskStatus,
} from "./queries";
import { TITLE_MAX, type MoveVia } from "./schemas";
import { TaskFormDialog, type TaskFormMode } from "./task-form-dialog";
import { MoveTaskDialog } from "./move-task-dialog";
import { TaskList } from "./task-list";
import { TaskMap } from "./task-map";
import { type TaskHandlers } from "./task-row";
import {
  keyboardTarget,
  MAX_TASK_LEVELS,
  openSubtasks,
  planMove,
  type MoveError,
  type MoveTarget,
} from "./task-tree";
import { useTaskView, type TaskView } from "./task-view-preference";
import type { Milestone, Task } from "./types";
import { useViewTracking } from "@/lib/analytics/use-view-tracking";

type TaskFormState = { open: boolean; mode: TaskFormMode };

/** The tasks of one milestone as a sortable list or a map, with quick add and task dialogs. */
export function TasksPanel({ milestone, tasks }: { milestone: Milestone; tasks: Task[] }) {
  const t = useTranslations("milestones.tasks");
  const milestoneId = milestone.id;
  const [view, setView] = useTaskView();
  useViewTracking("tasks", view);
  const setStatus = useSetTaskStatus(milestoneId);
  const create = useCreateTask(milestoneId);
  const remove = useDeleteTask(milestoneId);
  const move = useMoveTask(milestoneId);
  const awardXp = useAwardXp();
  const canEdit = useCan("milestones", "edit");
  const notesInWork = useNotesInWork();
  const noteTemplates = useTaskNoteTemplates(milestoneId, notesInWork.allowed);
  const writeNote = useWriteAndOpen();

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormState>({
    open: false,
    mode: { kind: "create", parent: null },
  });
  const [deleting, setDeleting] = useState<{ task: Task; open: boolean } | null>(null);
  const [moving, setMoving] = useState<{ task: Task; open: boolean } | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const quickRef = useRef<HTMLInputElement>(null);

  /** The last move of this visit, for ⌘/Ctrl + Z. */
  const lastMove = useRef<{ taskId: string; from: MoveTarget } | null>(null);

  function report(cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : String((cause as { message?: string })?.message);
    setError(
      message.includes("task_has_open_subtasks")
        ? t("errors.openSubtasks")
        : t("errors.saveFailed"),
    );
  }

  function moveMessage(error: MoveError | MoveTaskError["code"]) {
    if (error === "tooDeep") return t("errors.tooDeep", { max: MAX_TASK_LEVELS });
    if (error === "cycle") return t("errors.cycle");
    if (error === "readOnly") return t("errors.readOnly");
    return t("errors.saveFailed");
  }

  /**
   * Every move (map, list, keyboard, undo) goes through here: the same rules
   * first (a move that breaks them stays undone with a short message), then the
   * cache at once and moveTaskAction in the background.
   */
  function moveTask(taskId: string, target: MoveTarget, via: MoveVia) {
    if (!canEdit) return;
    const plan = planMove(tasks, taskId, target);
    if (!plan.ok) {
      setError(moveMessage(plan.error));
      return;
    }
    if (!plan.changed) return;
    setError(null);
    lastMove.current = via === "undo" ? null : { taskId, from: plan.from };
    move.mutate(
      { taskId, target, via },
      {
        onError: (cause) => {
          lastMove.current = null;
          setError(moveMessage(cause instanceof MoveTaskError ? cause.code : "unknown"));
        },
      },
    );
  }

  // ⌘/Ctrl + Z takes the last move back, unless the user is typing or in a dialog.
  const undoRef = useRef<() => void>(() => {});
  useEffect(() => {
    undoRef.current = () => {
      const last = lastMove.current;
      if (last) moveTask(last.taskId, last.from, "undo");
    };
  });
  useEffect(() => {
    if (!canEdit) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey || event.altKey || event.defaultPrevented || !lastMove.current) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")
      ) {
        return;
      }
      if (document.querySelector("[role='dialog'][data-open], [role='alertdialog'][data-open]")) {
        return;
      }
      event.preventDefault();
      undoRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit]);

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
      setStatus.mutate(
        { id: task.id, status },
        {
          onError: report,
          // A quiet, small reward: no confetti, just a bit of XP.
          onSuccess: () => {
            if (status === "done") {
              awardXp.mutate({ reason: "task_completed", refId: task.id });
            }
          },
        },
      );
    },
    onAddSubtask: (task) => setForm({ open: true, mode: { kind: "create", parent: task } }),
    onEdit: (task) => setForm({ open: true, mode: { kind: "edit", task } }),
    onKeyMove: (task, direction) => {
      const target = keyboardTarget(tasks, task.id, direction);
      if (target) moveTask(task.id, target, "keyboard");
    },
    onMoveMenu: (task) => setMoving({ task, open: true }),
    readOnly: !canEdit,
    noteTemplates: noteTemplates.data,
    onWriteNote:
      notesInWork.allowed && !notesInWork.readOnly
        ? (task) =>
            writeNote.run(
              { kind: "task", id: task.id, milestoneId },
              task.title,
              noteTemplates.data?.[task.id] ?? null,
            )
        : undefined,
    onDelete: (task) => {
      if (tasks.some((other) => other.parent_task_id === task.id)) {
        setDeleting({ task, open: true });
      } else {
        setError(null);
        remove.mutate(task.id, { onError: report });
      }
    },
  };

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
      {writeNote.failed && <FormAlert>{t("writeNoteFailed")}</FormAlert>}

      {view === "map" ? (
        <TaskMap
          milestone={milestone}
          tasks={tasks}
          onOpen={handlers.onEdit}
          onToggleDone={handlers.onToggleDone}
          onAddChild={(parent) => setForm({ open: true, mode: { kind: "create", parent } })}
          onMove={canEdit ? moveTask : undefined}
          readOnly={!canEdit}
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<ListChecksIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            canEdit && (
              <Button variant="outline" onClick={() => quickRef.current?.focus()}>
                {t("emptyAction")}
              </Button>
            )
          }
        />
      ) : (
        <TaskList
          handlers={handlers}
          onMove={(taskId, target) => moveTask(taskId, target, "list")}
        />
      )}

      {canEdit && (
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
      )}

      <TaskFormDialog
        open={form.open}
        onOpenChange={(open) => setForm((current) => ({ ...current, open }))}
        milestoneId={milestoneId}
        tasks={tasks}
        mode={form.mode}
      />

      <MoveTaskDialog
        open={moving?.open ?? false}
        onOpenChange={(open) => setMoving((current) => current && { ...current, open })}
        milestoneTitle={milestone.title}
        tasks={tasks}
        task={moving?.task ?? null}
        onMove={(taskId, target) => moveTask(taskId, target, "menu")}
      />

      {deleting && (
        <ConfirmDialog
          open={deleting.open}
          onOpenChange={(open) => setDeleting((current) => current && { ...current, open })}
          title={t("deleteDialog.title")}
          description={t("deleteDialog.description", {
            title: deleting.task.title,
            count: tasks.filter((task) => task.parent_task_id === deleting.task.id).length,
          })}
          confirmLabel={t("deleteDialog.confirm")}
          cancelLabel={t("deleteDialog.cancel")}
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
