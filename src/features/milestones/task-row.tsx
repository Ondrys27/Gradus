"use client";

import type { KeyboardEvent } from "react";
import { Menu } from "@base-ui/react/menu";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import {
  ChevronDownIcon,
  EllipsisIcon,
  GripVerticalIcon,
  NotebookPenIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { differenceInCalendarDays } from "date-fns";
import { useTranslations } from "next-intl";
import { formatCalendarDate, isoDateToLocal, todayIsoDate } from "@/lib/format";
import type { NoteTemplateKey } from "@/features/notes/templates";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { TaskCheckbox } from "./task-checkbox";
import { taskVisualState } from "./task-status";
import { TaskStatePill } from "./task-status-ui";
import { openSubtasks, type FlatTask, type MoveDirection } from "./task-tree";
import type { Task } from "./types";

export type TaskHandlers = {
  tasks: Task[];
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
  onToggleDone: (task: Task) => void;
  onAddSubtask: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  /** ⌘/Ctrl + arrows on a row: ←/→ level, ↑/↓ order. */
  onKeyMove: (task: Task, direction: MoveDirection) => void;
  /** Without the right to edit milestones: no ticking, moving or menu. */
  readOnly?: boolean;
  /** Path steps whose result is a text, with the key of their note outline. */
  noteTemplates?: Readonly<Record<string, NoteTemplateKey>>;
  /** "Write in notes"; missing where notes are not the account's own (a worker). */
  onWriteNote?: (task: Task) => void;
};

const ARROWS: Record<string, MoveDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

type KeyLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** The direction of ⌘/Ctrl + an arrow, or null for any other key. */
export function moveDirectionOf(event: KeyLike): MoveDirection | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return null;
  return ARROWS[event.key] ?? null;
}

const MOVE = { duration: 0.32, ease: [0.16, 1, 0.3, 1] } as const;

type RowProps = {
  row: FlatTask;
  /** The level the row is drawn on: while dragged, where it would land. */
  depth: number;
  /** Px per level. */
  indent: number;
  handlers: TaskHandlers;
  /** Any row is being dragged: no layout animation meanwhile. */
  dragging: boolean;
};

/** One task of the list, indented by its level; dragged by the grip on the left. */
export function TaskRow({ row, depth, indent, handlers, dragging }: RowProps) {
  const t = useTranslations("milestones.tasks");
  const settings = useFormatSettings();
  const reduceMotion = useReducedMotionSafe();
  const { task, childCount } = row;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: handlers.readOnly });

  const done = task.status === "done";
  const remaining = openSubtasks(handlers.tasks, task.id);
  const inProgress = taskVisualState(task, remaining) === "in_progress";
  const expanded = !handlers.collapsed.has(task.id);
  const today = todayIsoDate(settings);
  const overdue = !done && !!task.due_date && task.due_date < today;
  const daysOverdue = overdue
    ? differenceInCalendarDays(isoDateToLocal(today), isoDateToLocal(task.due_date!))
    : 0;
  const wayOverdue = overdue && daysOverdue > 3;

  function onKeyDown(event: KeyboardEvent) {
    if (handlers.readOnly || isDragging) return;
    const direction = moveDirectionOf(event);
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    handlers.onKeyMove(task, direction);
  }

  return (
    <li
      ref={setNodeRef}
      data-task-row={task.id}
      data-depth={depth}
      style={{ transform: CSS.Translate.toString(transform && { ...transform, x: 0 }), transition }}
      className={cn("relative", isDragging && "z-10")}
      onKeyDown={onKeyDown}
    >
      {/* One guide per level above, where the nested groups used to draw theirs. */}
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-line/60"
          style={{ left: level * indent + indent / 2 }}
        />
      ))}
      <motion.div
        layout={dragging || reduceMotion ? false : "position"}
        transition={MOVE}
        style={{ marginLeft: depth * indent }}
        className={cn(
          "flex min-h-11 items-center gap-1 rounded-xl pr-1 hover:bg-surface-hover",
          isDragging && "bg-surface-hover opacity-80 shadow-glow ring-1 ring-violet/50",
        )}
      >
        {handlers.readOnly ? (
          <span aria-hidden className="size-3 shrink-0" />
        ) : (
          <button
            type="button"
            ref={setActivatorNodeRef}
            aria-label={t("reorder", { title: task.title })}
            aria-keyshortcuts="Meta+ArrowUp Meta+ArrowDown Meta+ArrowLeft Meta+ArrowRight Control+ArrowUp Control+ArrowDown Control+ArrowLeft Control+ArrowRight"
            data-testid="task-drag-handle"
            className="grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 active:cursor-grabbing mouse:size-8"
            {...attributes}
            {...listeners}
          >
            <GripVerticalIcon aria-hidden className="size-4" />
          </button>
        )}

        <TaskCheckbox
          title={task.title}
          done={done}
          inProgress={inProgress}
          remaining={remaining}
          disabled={handlers.readOnly}
          onToggle={() => handlers.onToggleDone(task)}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1 py-2 pl-2">
          <span
            className={cn(
              "text-[15px] leading-snug break-words text-ink",
              done && "text-ink-muted line-through",
            )}
          >
            {task.title}
          </span>
          {(inProgress || task.due_date || childCount > 0) && (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
              {inProgress && <TaskStatePill state="in_progress" />}
              {task.due_date && (
                <span className={cn(overdue && "text-pink")}>
                  {t(overdue ? "overdue" : "due", {
                    date: formatCalendarDate(task.due_date, settings),
                  })}
                </span>
              )}
              {childCount > 0 && <span>{t("subtasks", { count: childCount })}</span>}
            </span>
          )}
          {wayOverdue && (
            <span className="text-xs font-medium text-pink">
              {t("wayOverdue", { days: daysOverdue })}
            </span>
          )}
        </div>

        {handlers.onWriteNote && handlers.noteTemplates?.[task.id] && !done && (
          <button
            type="button"
            onClick={() => handlers.onWriteNote?.(task)}
            aria-label={t("writeNote", { title: task.title })}
            title={t("writeNote", { title: task.title })}
            data-testid="task-write-note"
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-violet outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
          >
            <NotebookPenIcon aria-hidden className="size-4" />
          </button>
        )}

        {childCount > 0 && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? t("collapse") : t("expand")}
            onClick={() => handlers.onToggleCollapsed(task.id)}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
          >
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-4 transition-transform motion-reduce:transition-none",
                !expanded && "-rotate-90",
              )}
            />
          </button>
        )}

        {!handlers.readOnly && <TaskMenu task={task} handlers={handlers} />}
      </motion.div>
    </li>
  );
}

function TaskMenu({ task, handlers }: { task: Task; handlers: TaskHandlers }) {
  const t = useTranslations("milestones.tasks");
  const itemClass =
    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9 [&_svg]:size-4";

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("actions", { title: task.title })}
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
      >
        <EllipsisIcon aria-hidden className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-popover">
          <Menu.Popup className="min-w-48 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
            <Menu.Item className={itemClass} onClick={() => handlers.onAddSubtask(task)}>
              <PlusIcon aria-hidden />
              {t("addSubtask")}
            </Menu.Item>
            <Menu.Item className={itemClass} onClick={() => handlers.onEdit(task)}>
              <PencilIcon aria-hidden />
              {t("edit")}
            </Menu.Item>
            {handlers.onWriteNote && (
              <Menu.Item className={itemClass} onClick={() => handlers.onWriteNote?.(task)}>
                <NotebookPenIcon aria-hidden />
                {t("writeNoteMenu")}
              </Menu.Item>
            )}
            <Menu.Item
              className={cn(itemClass, "text-pink")}
              onClick={() => handlers.onDelete(task)}
            >
              <Trash2Icon aria-hidden />
              {t("delete")}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
