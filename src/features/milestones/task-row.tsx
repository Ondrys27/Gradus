"use client";

import type { KeyboardEvent, SyntheticEvent } from "react";
import { Menu } from "@base-ui/react/menu";
import { useDraggable } from "@dnd-kit/core";
import { motion } from "framer-motion";
import {
  ChevronDownIcon,
  EllipsisIcon,
  GripVerticalIcon,
  MoveIcon,
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
  /** "Move…" in the menu: pick the new parent and place without a mouse. */
  onMoveMenu: (task: Task) => void;
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
  /** This is the dragged row: it stays as a faint placeholder while its card travels. */
  placeholder?: boolean;
  /** The dragged task would become this one's last subtask; "invalid" when the rules refuse it. */
  dropInside?: "ok" | "invalid" | null;
};

/** Only events that start on the row itself, not in a menu it opened (portals bubble in React). */
const ownEvent = (event: SyntheticEvent) =>
  event.currentTarget.contains(event.target as Node | null);

/**
 * One task of the list, indented by its level. The whole row can be dragged
 * (after a long press on a phone); the grip on the left shows it.
 */
export function TaskRow({
  row,
  depth,
  indent,
  handlers,
  dragging,
  placeholder = false,
  dropInside = null,
}: RowProps) {
  const t = useTranslations("milestones.tasks");
  const settings = useFormatSettings();
  const reduceMotion = useReducedMotionSafe();
  const { task, childCount } = row;
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: task.id,
    disabled: handlers.readOnly,
  });

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
    if (handlers.readOnly || dragging) return;
    const direction = moveDirectionOf(event);
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    handlers.onKeyMove(task, direction);
  }

  return (
    <li
      data-task-row={task.id}
      data-depth={depth}
      data-drop-inside={dropInside ?? undefined}
      className="relative"
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
        ref={setNodeRef}
        layout={dragging || reduceMotion ? false : "position"}
        transition={MOVE}
        style={{ marginLeft: depth * indent }}
        className={cn(
          "flex min-h-11 items-center gap-1 rounded-xl pr-1 transition-[opacity,box-shadow] duration-150 hover:bg-surface-hover motion-reduce:transition-none",
          !handlers.readOnly &&
            "cursor-grab touch-manipulation select-none [-webkit-touch-callout:none]",
          placeholder && "opacity-40 outline-1 outline-line-strong outline-dashed",
          dropInside === "ok" && "bg-gold/10 ring-2 ring-gold",
          dropInside === "invalid" && "cursor-not-allowed opacity-50 ring-2 ring-line-strong",
        )}
        onMouseDown={(event) => {
          if (ownEvent(event)) listeners?.onMouseDown?.(event);
        }}
        onTouchStart={(event) => {
          if (ownEvent(event)) listeners?.onTouchStart?.(event);
        }}
      >
        {handlers.readOnly ? (
          <span aria-hidden className="size-3 shrink-0" />
        ) : (
          <span
            aria-hidden
            data-testid="task-drag-handle"
            className="grid size-11 shrink-0 place-items-center rounded-lg text-ink-muted mouse:size-8"
          >
            <GripVerticalIcon className="size-4" />
          </span>
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

        {!handlers.readOnly && (
          <TaskMenu task={task} handlers={handlers} describedBy={attributes["aria-describedby"]} />
        )}
      </motion.div>
    </li>
  );
}

type MenuProps = {
  task: Task;
  handlers: TaskHandlers;
  /** The instructions for moving with a pointer or the keyboard. */
  describedBy?: string;
};

function TaskMenu({ task, handlers, describedBy }: MenuProps) {
  const t = useTranslations("milestones.tasks");
  const itemClass =
    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9 [&_svg]:size-4";

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("actions", { title: task.title })}
        aria-describedby={describedBy}
        aria-keyshortcuts="Meta+ArrowUp Meta+ArrowDown Meta+ArrowLeft Meta+ArrowRight Control+ArrowUp Control+ArrowDown Control+ArrowLeft Control+ArrowRight"
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
            <Menu.Item className={itemClass} onClick={() => handlers.onMoveMenu(task)}>
              <MoveIcon aria-hidden />
              {t("moveMenu")}
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

/** The dragged task as one card, carrying everything below it. */
export function TaskDragCard({ task, below }: { task: Task; below: number }) {
  const t = useTranslations("milestones.tasks");
  // Narrower than a row, so the row it is over still shows that it lights up.
  return (
    <div
      data-testid="task-drag-card"
      className="flex min-h-11 w-max max-w-[min(100%,20rem)] cursor-grabbing items-center gap-2 rounded-xl border border-violet/70 bg-surface/95 px-3 shadow-glow-strong motion-safe:rotate-1"
    >
      <GripVerticalIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
      <span
        aria-hidden
        className={cn(
          "size-4 shrink-0 rounded-full border-2",
          task.status === "done" ? "border-teal bg-teal" : "border-line-strong",
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[15px] text-ink",
          task.status === "done" && "text-ink-muted line-through",
        )}
      >
        {task.title}
      </span>
      {below > 0 && (
        <span className="shrink-0 rounded-full border border-violet bg-canvas-deep px-2 py-0.5 text-xs font-semibold text-ink">
          {t("subtasks", { count: below })}
        </span>
      )}
    </div>
  );
}
