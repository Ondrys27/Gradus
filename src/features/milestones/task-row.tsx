"use client";

import { Menu } from "@base-ui/react/menu";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDownIcon,
  EllipsisIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { differenceInCalendarDays } from "date-fns";
import { useTranslations } from "next-intl";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCalendarDate, isoDateToLocal, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { TaskCheckbox } from "./task-checkbox";
import { openSubtasks, type TaskNode } from "./task-tree";
import type { Task } from "./types";

export type TaskHandlers = {
  tasks: Task[];
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (id: string) => void;
  onToggleDone: (task: Task) => void;
  onAddSubtask: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
};

/** One level of siblings; every level is its own sortable list. */
export function TaskGroup({ nodes, handlers }: { nodes: TaskNode[]; handlers: TaskHandlers }) {
  return (
    <SortableContext
      items={nodes.map((node) => node.task.id)}
      strategy={verticalListSortingStrategy}
    >
      <ul className="flex flex-col">
        {nodes.map((node) => (
          <TaskRow key={node.task.id} node={node} handlers={handlers} />
        ))}
      </ul>
    </SortableContext>
  );
}

function TaskRow({ node, handlers }: { node: TaskNode; handlers: TaskHandlers }) {
  const t = useTranslations("milestones.tasks");
  const settings = useFormatSettings();
  const { task, children } = node;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { parentId: task.parent_task_id } });

  const done = task.status === "done";
  const expanded = !handlers.collapsed.has(task.id);
  const today = todayIsoDate(settings);
  const overdue = !done && !!task.due_date && task.due_date < today;
  const daysOverdue = overdue
    ? differenceInCalendarDays(isoDateToLocal(today), isoDateToLocal(task.due_date!))
    : 0;
  const wayOverdue = overdue && daysOverdue > 3;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-70")}
    >
      <div className="flex min-h-11 items-center gap-1 rounded-xl pr-1 hover:bg-surface-hover">
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={t("reorder", { title: task.title })}
          className="grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 active:cursor-grabbing mouse:size-8"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon aria-hidden className="size-4" />
        </button>

        <TaskCheckbox
          title={task.title}
          done={done}
          remaining={openSubtasks(handlers.tasks, task.id)}
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
          {(task.status === "in_progress" || task.due_date || children.length > 0) && (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
              {task.status === "in_progress" && (
                <StatusPill tone="gold" dot>
                  {t("status.in_progress")}
                </StatusPill>
              )}
              {task.due_date && (
                <span className={cn(overdue && "text-pink")}>
                  {t(overdue ? "overdue" : "due", {
                    date: formatCalendarDate(task.due_date, settings),
                  })}
                </span>
              )}
              {children.length > 0 && <span>{t("subtasks", { count: children.length })}</span>}
            </span>
          )}
          {wayOverdue && (
            <span className="text-xs font-medium text-pink">
              {t("wayOverdue", { days: daysOverdue })}
            </span>
          )}
        </div>

        {children.length > 0 && (
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

        <TaskMenu task={task} handlers={handlers} />
      </div>

      {children.length > 0 && expanded && (
        <div className="ml-4 border-l border-line/60 pl-1 sm:ml-7">
          <TaskGroup nodes={children} handlers={handlers} />
        </div>
      )}
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
        <Menu.Positioner sideOffset={6} align="end" className="z-50">
          <Menu.Popup className="min-w-48 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
            <Menu.Item className={itemClass} onClick={() => handlers.onAddSubtask(task)}>
              <PlusIcon aria-hidden />
              {t("addSubtask")}
            </Menu.Item>
            <Menu.Item className={itemClass} onClick={() => handlers.onEdit(task)}>
              <PencilIcon aria-hidden />
              {t("edit")}
            </Menu.Item>
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
