"use client";

import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { TreeMap } from "@/components/tree-map/tree-map";
import { MAP_DRAG_NODE } from "@/components/tree-map/tree-map-layout";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { toBranch } from "./task-map-layout";
import { TaskMapDragPreview, TaskMapNode, TaskMapRoot } from "./task-map-node";
import { moveDirectionOf } from "./task-row";
import { TaskStateLegend } from "./task-status-ui";
import {
  buildTree,
  keyboardTarget,
  mapDropTarget,
  mapDropZone,
  planMove,
  subtreeIds,
  type MapDropZone,
  type MoveDirection,
  type MoveTarget,
} from "./task-tree";
import type { Milestone, Task } from "./types";

type Props = {
  milestone: Milestone;
  tasks: Task[];
  onOpen: (task: Task) => void;
  onToggleDone: (task: Task) => void;
  onAddChild: (parent: Task | null) => void;
  /** Moves a task; absent without the right to edit milestones. */
  onMove?: (taskId: string, target: MoveTarget, via: "map" | "keyboard") => void;
  /** Without the right to edit milestones: look only. */
  readOnly?: boolean;
};

const noop = () => {};
const subscribeNever = () => noop;

/** Where the dragged node would land: over a node (null = the milestone) in a zone. */
type Hint = { overId: string | null; zone: MapDropZone; valid: boolean };

type Drag = { id: string; subtree: ReadonlySet<string>; scale: number };

/**
 * Tasks as a horizontal tree: the milestone is the root, tasks the branches,
 * subtasks the leaves. A task is dragged (on a phone after a long press) onto
 * another task to become its subtask, between tasks to change the order, or
 * onto the milestone to go to level 1; its subtree goes along. ⌘/Ctrl + arrows
 * move the focused task.
 */
export function TaskMap({
  milestone,
  tasks,
  onOpen,
  onToggleDone,
  onAddChild,
  onMove,
  readOnly = false,
}: Props) {
  const t = useTranslations("milestones.map");
  const tm = useTranslations("milestones.tasks.move");
  const reduceMotion = useReducedMotionSafe();
  const canMove = !readOnly && Boolean(onMove);
  const tree = useMemo(() => toBranch(milestone.id, buildTree(tasks)), [milestone.id, tasks]);
  // The overlay goes to <body>, which exists only in the browser.
  const inBrowser = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const { taskById, openChildren } = useMemo(() => {
    const openChildren = new Map<string, number>();
    for (const task of tasks) {
      if (task.parent_task_id && task.status !== "done") {
        openChildren.set(task.parent_task_id, (openChildren.get(task.parent_task_id) ?? 0) + 1);
      }
    }
    return { taskById: new Map(tasks.map((task) => [task.id, task])), openChildren };
  }, [tasks]);

  const [drag, setDrag] = useState<Drag | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  /** Read when the drop happens: a drop that cannot happen floats back to its place. */
  const [floatBack, setFloatBack] = useState(true);
  /** A long press ends in a click; it must not open the task it just dropped. */
  const justDragged = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A long press, so a short swipe still scrolls the page or moves the map.
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );

  const doneCount = tasks.filter((task) => task.status === "done").length;
  const titleOf = (id: unknown) =>
    id === milestone.id ? milestone.title : (taskById.get(String(id))?.title ?? "");

  const announcements: Announcements = {
    onDragStart: ({ active }) => tm("pickedUp", { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id
        ? tm("over", { title: titleOf(active.id), target: titleOf(over.id) })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over ? tm("dropped", { title: titleOf(active.id) }) : tm("cancelled"),
    onDragCancel: () => tm("cancelled"),
  };

  function targetOf(activeId: string, current: Hint | null): MoveTarget | null {
    if (!current) return null;
    return mapDropTarget(tasks, activeId, current.overId, current.zone);
  }

  function onDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    justDragged.current = true;
    // The node is drawn scaled with the map; the floating copy keeps that size.
    const element = document.querySelector<HTMLElement>(`[data-map-drag="${CSS.escape(id)}"]`);
    const scale =
      element && element.offsetWidth > 0
        ? element.getBoundingClientRect().width / element.offsetWidth
        : 1;
    setDrag({ id, subtree: subtreeIds(tasks, id), scale });
    setHint(null);
  }

  function onDragMove({ active, over, activatorEvent, delta }: DragMoveEvent) {
    const start = getEventCoordinates(activatorEvent);
    if (!over || !start) {
      if (hint) setHint(null);
      return;
    }
    const overId = over.id === milestone.id ? null : String(over.id);
    const zone = overId === null ? "inside" : mapDropZone(over.rect, start.y + delta.y);
    if (hint && hint.overId === overId && hint.zone === zone) return;
    const target = mapDropTarget(tasks, String(active.id), overId, zone);
    const plan = target ? planMove(tasks, String(active.id), target) : null;
    setHint({ overId, zone, valid: Boolean(plan?.ok) });
  }

  function finish() {
    setDrag(null);
    setHint(null);
    // The click that ends a long press comes right after the drop.
    window.setTimeout(() => (justDragged.current = false), 80);
  }

  function onDragEnd() {
    const target = drag ? targetOf(drag.id, hint) : null;
    const id = drag?.id;
    setFloatBack(!(target && hint?.valid));
    finish();
    if (id && target) onMove?.(id, target, "map");
  }

  function keyMove(id: string, direction: MoveDirection) {
    const target = keyboardTarget(tasks, id, direction);
    if (target) onMove?.(id, target, "keyboard");
  }

  // The parent the dragged task would land under, and the sibling it lands next to.
  const parentHighlight =
    hint === null
      ? undefined
      : hint.zone === "inside"
        ? (hint.overId ?? milestone.id)
        : (taskById.get(hint.overId ?? "")?.parent_task_id ?? milestone.id);
  const line = hint && hint.zone !== "inside" ? { id: hint.overId, side: hint.zone } : null;

  const map = (
    <TreeMap
      tree={tree}
      label={t("label")}
      contentKey={`${milestone.title}|${milestone.status}`}
      overlay={<TaskStateLegend />}
      locked={drag !== null}
      wrapNode={
        canMove
          ? (id, node) => (
              <MapDragNode
                id={id}
                root={id === milestone.id}
                dimmed={drag?.subtree.has(id) ?? false}
                highlight={parentHighlight === id ? (hint?.valid ? "ok" : "invalid") : null}
                line={line?.id === id ? (line.side as "before" | "after") : null}
                lineValid={hint?.valid ?? true}
                onKeyMove={(direction) => keyMove(id, direction)}
              >
                {node}
              </MapDragNode>
            )
          : undefined
      }
      renderNode={(id, node) => {
        const task = taskById.get(id);
        if (!task) {
          return (
            <TaskMapRoot
              title={milestone.title}
              done={doneCount}
              total={tasks.length}
              completed={milestone.status === "completed"}
              onAddChild={readOnly ? undefined : node.measuring ? noop : () => onAddChild(null)}
            />
          );
        }
        return (
          <TaskMapNode
            task={task}
            remaining={openChildren.get(id) ?? 0}
            childCount={node.childCount}
            hiddenCount={node.hiddenCount}
            collapsed={node.collapsed}
            onOpen={
              node.measuring || readOnly
                ? noop
                : () => {
                    if (!justDragged.current) onOpen(task);
                  }
            }
            onToggleDone={node.measuring || readOnly ? noop : () => onToggleDone(task)}
            onAddChild={readOnly ? undefined : node.measuring ? noop : () => onAddChild(task)}
            readOnly={readOnly}
            onToggleCollapsed={node.onToggleCollapsed}
          />
        );
      }}
    />
  );

  if (!canMove) return map;

  const dragged = drag ? taskById.get(drag.id) : undefined;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      autoScroll={false}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: tm("mapInstructions") },
      }}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setFloatBack(true);
        finish();
      }}
    >
      {map}
      {inBrowser &&
        createPortal(
          // A real drop lets the map glide the node to its new place.
          <DragOverlay dropAnimation={floatBack && !reduceMotion ? undefined : null}>
            {dragged && drag && (
              <TaskMapDragPreview task={dragged} below={drag.subtree.size - 1} scale={drag.scale} />
            )}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

type MapDragNodeProps = {
  id: string;
  root: boolean;
  /** Part of the dragged subtree: no drop target, drawn faint. */
  dimmed: boolean;
  /** The parent the dragged task would land under. */
  highlight: "ok" | "invalid" | null;
  /** The dragged task would land right before or after this one. */
  line: "before" | "after" | null;
  lineValid: boolean;
  onKeyMove: (direction: MoveDirection) => void;
  children: ReactNode;
};

/** A node of the map that can be dragged (a task) and dropped on (a task or the milestone). */
function MapDragNode({
  id,
  root,
  dimmed,
  highlight,
  line,
  lineValid,
  onKeyMove,
  children,
}: MapDragNodeProps) {
  const draggable = useDraggable({ id, disabled: root });
  const droppable = useDroppable({ id, disabled: dimmed });
  const tone = (valid: boolean) => (valid ? "border-gold bg-gold" : "border-pink bg-pink");

  return (
    <div
      ref={root ? undefined : draggable.setNodeRef}
      data-map-drag={root ? undefined : id}
      aria-describedby={root ? undefined : draggable.attributes["aria-describedby"]}
      onKeyDown={(event) => {
        if (root) return;
        const direction = moveDirectionOf(event);
        if (!direction) return;
        event.preventDefault();
        event.stopPropagation();
        onKeyMove(direction);
      }}
      className={cn(
        "relative transition-opacity duration-200",
        !root &&
          cn(
            MAP_DRAG_NODE,
            "touch-manipulation select-none [-webkit-touch-callout:none]",
            draggable.isDragging ? "cursor-grabbing" : "cursor-grab",
          ),
        dimmed && "opacity-35",
      )}
      {...(root ? {} : draggable.listeners)}
    >
      {/* The drop area reaches halfway into the gaps, so "between" always hits a node. */}
      <span
        ref={droppable.setNodeRef}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-2 -bottom-2"
      />
      {highlight && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-1.5 rounded-[20px] border-2 bg-transparent",
            highlight === "ok"
              ? "border-gold shadow-[0_0_28px_-6px_var(--color-gold)]"
              : "border-pink",
          )}
        />
      )}
      {line && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-3 h-1 rounded-full",
            tone(lineValid),
            line === "before" ? "-top-2.5" : "-bottom-2.5",
          )}
        />
      )}
      {children}
    </div>
  );
}
