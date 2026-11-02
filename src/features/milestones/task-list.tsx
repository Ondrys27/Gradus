"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { useMediaQuery, useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { TaskDragCard, TaskRow, type TaskHandlers } from "./task-row";
import {
  buildTree,
  flattenTree,
  listDropAt,
  planMove,
  subtreeIds,
  type FlatTask,
  type ListDrop,
  type MoveTarget,
} from "./task-tree";
import type { Task } from "./types";

/** Px per level: as deep as the nested groups used to be. */
const INDENT = { phone: 20, wide: 28 } as const;

/** How long a collapsed task under the pointer waits before it opens. */
export const EXPAND_AFTER_MS = 600;

type Props = {
  handlers: TaskHandlers;
  onMove: (taskId: string, target: MoveTarget) => void;
};

type Drag = { activeId: string; below: number };

const noop = () => {};
const subscribeNever = () => noop;

function sameDrop(a: ListDrop | null, b: ListDrop | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.kind === b.kind &&
    a.depth === b.depth &&
    a.valid === b.valid &&
    a.target.parentId === b.target.parentId &&
    a.target.index === b.target.index &&
    (a.kind === "inside" ? a.overId === (b as typeof a).overId : a.y === (b as typeof a).y)
  );
}

/**
 * The tasks as one list of rows indented by level. A row is dragged (on a
 * phone after a long press) with everything below it, folded into one card.
 * Meanwhile a live line shows where it lands: the place picks the gap, the
 * sideways drag the level (half an indent per step, so several levels at
 * once). The middle of a row makes it that task's last subtask, as in the map;
 * a collapsed task opens when the pointer stays on it. A drop the rules refuse
 * is drawn grey and does not happen. The list scrolls by itself at the edges.
 */
export function TaskList({ handlers, onMove }: Props) {
  const t = useTranslations("milestones.tasks.move");
  const wide = useMediaQuery("(min-width: 640px)");
  const reduceMotion = useReducedMotionSafe();
  const indent = wide ? INDENT.wide : INDENT.phone;
  const { tasks } = handlers;
  const inBrowser = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<ListDrop | null>(null);
  /** Read when the drop happens: a drop that does not move anything floats back. */
  const [floatBack, setFloatBack] = useState(true);
  /** The pointer from the top of the list and sideways from the start, while dragging. */
  const pointer = useRef<{ startY: number; y: number; offsetX: number } | null>(null);
  const dropRef = useRef<ListDrop | null>(null);

  const tree = useMemo(() => buildTree(tasks), [tasks]);
  const rows = useMemo(() => {
    const hidden = new Set(handlers.collapsed);
    // The dragged task carries its subtasks; they are not rows of their own meanwhile.
    if (drag) hidden.add(drag.activeId);
    return flattenTree(tree, hidden);
  }, [tree, handlers.collapsed, drag]);

  const latest = useRef<{ rows: FlatTask[]; tasks: Task[]; indent: number; activeId?: string }>({
    rows,
    tasks,
    indent,
  });
  const toggleCollapsed = useRef(handlers.onToggleCollapsed);
  useLayoutEffect(() => {
    latest.current = { rows, tasks, indent, activeId: drag?.activeId };
    toggleCollapsed.current = handlers.onToggleCollapsed;
  });

  /** Measures the rows as drawn now and finds the drop under the pointer. */
  const locate = useCallback(() => {
    const list = listRef.current;
    const at = pointer.current;
    const { rows, tasks, indent, activeId } = latest.current;
    if (!list || !at || !activeId) return;
    const base = list.getBoundingClientRect().top;
    const elements = new Map<string, HTMLElement>();
    list.querySelectorAll<HTMLElement>("[data-task-row]").forEach((element) => {
      elements.set(element.dataset.taskRow ?? "", element);
    });
    const boxes = rows.flatMap((row) => {
      const element = elements.get(row.task.id);
      if (!element) return [];
      const rect = element.getBoundingClientRect();
      return [{ ...row, top: rect.top - base, height: rect.height }];
    });
    const next = listDropAt(tasks, boxes, activeId, { y: at.y, offsetX: at.offsetX }, indent);
    dropRef.current = next;
    setDrop((current) => (sameDrop(current, next) ? current : next));
  }, []);

  // Rows come and go (the subtree folds in, a collapsed task opens): measure again.
  useLayoutEffect(() => {
    if (drag) locate();
  }, [drag, rows, locate]);

  // A collapsed task under the pointer opens after a moment.
  const expandId =
    drop?.kind === "inside" && rows.some((row) => row.task.id === drop.overId && row.collapsed)
      ? drop.overId
      : null;
  useEffect(() => {
    if (!expandId) return;
    const timer = window.setTimeout(() => toggleCollapsed.current(expandId), EXPAND_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [expandId]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A long press, so a short swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );

  const titleOf = (id: unknown) => tasks.find((task) => task.id === String(id))?.title ?? "";
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("pickedUp", { title: titleOf(active.id) }),
    onDragOver: () => undefined,
    onDragEnd: ({ active }) =>
      dropRef.current?.valid ? t("dropped", { title: titleOf(active.id) }) : t("cancelled"),
    onDragCancel: () => t("cancelled"),
  };

  function finish() {
    setDrag(null);
    setDrop(null);
    pointer.current = null;
    dropRef.current = null;
  }

  function onDragStart({ active, activatorEvent }: DragStartEvent) {
    const id = String(active.id);
    const start = getEventCoordinates(activatorEvent);
    const list = listRef.current;
    const startY = start && list ? start.y - list.getBoundingClientRect().top : 0;
    pointer.current = { startY, y: startY, offsetX: 0 };
    dropRef.current = null;
    setDrop(null);
    setDrag({ activeId: id, below: subtreeIds(tasks, id).size - 1 });
  }

  function onDragMove({ delta }: DragMoveEvent) {
    const at = pointer.current;
    if (!at) return;
    // The delta includes scrolling, so this stays the place within the list.
    pointer.current = { ...at, y: at.startY + delta.y, offsetX: delta.x };
    locate();
  }

  function onDragEnd() {
    const final = dropRef.current;
    const activeId = drag?.activeId;
    const plan = final && activeId ? planMove(tasks, activeId, final.target) : null;
    setFloatBack(!(final?.valid && plan?.ok && plan.changed));
    finish();
    // A refused drop still goes to the panel, which says why it cannot happen.
    if (final && activeId) onMove(activeId, final.target);
  }

  const dragged = drag ? tasks.find((task) => task.id === drag.activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      autoScroll={{ threshold: { x: 0, y: 0.15 }, acceleration: 12 }}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t("listInstructions") },
      }}
      onDragStart={handlers.readOnly ? undefined : onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setFloatBack(true);
        finish();
      }}
    >
      <div className="relative">
        <ul ref={listRef} className="flex flex-col" data-testid="task-list">
          {rows.map((row) => (
            <TaskRow
              key={row.task.id}
              row={row}
              depth={row.depth}
              indent={indent}
              handlers={handlers}
              dragging={drag !== null}
              placeholder={row.task.id === drag?.activeId}
              dropInside={
                drop?.kind === "inside" && drop.overId === row.task.id
                  ? drop.valid
                    ? "ok"
                    : "invalid"
                  : null
              }
            />
          ))}
        </ul>
        {drop?.kind === "line" && (
          <div
            aria-hidden
            data-testid="task-drop-line"
            data-depth={drop.depth}
            data-valid={drop.valid}
            className={cn(
              "pointer-events-none absolute right-1 h-0.5 -translate-y-1/2 rounded-full",
              drop.valid ? "bg-gold shadow-[0_0_12px_var(--color-gold)]" : "bg-ink-muted/50",
            )}
            style={{ top: drop.y, left: drop.depth * indent + 10 }}
          >
            <span
              className={cn(
                "absolute top-1/2 -left-2 size-2.5 -translate-y-1/2 rounded-full border-2 bg-canvas",
                drop.valid ? "border-gold" : "border-ink-muted/50",
              )}
            />
          </div>
        )}
      </div>
      {inBrowser &&
        createPortal(
          <DragOverlay dropAnimation={floatBack && !reduceMotion ? undefined : null}>
            {dragged && drag && <TaskDragCard task={dragged} below={drag.below} />}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}
