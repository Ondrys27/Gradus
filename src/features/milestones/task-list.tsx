"use client";

import { useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";
import { useMediaQuery } from "@/lib/use-media-query";
import { TaskRow, type TaskHandlers } from "./task-row";
import { buildTree, flattenTree, projectListDrop, type MoveTarget } from "./task-tree";

/** Px per level: as deep as the nested groups used to be. */
const INDENT = { phone: 20, wide: 28 } as const;

type Props = {
  handlers: TaskHandlers;
  onMove: (taskId: string, target: MoveTarget) => void;
};

type Drag = { activeId: string; overId: string; offsetX: number };

/**
 * The tasks as one sortable list of rows indented by level. A row is dragged
 * by its grip: up and down changes the place, sideways the level (one level
 * per indent, as in Things or Todoist), always within what the rows around
 * allow. Everything below the dragged task goes along (hidden meanwhile).
 */
export function TaskList({ handlers, onMove }: Props) {
  const t = useTranslations("milestones.tasks.move");
  const wide = useMediaQuery("(min-width: 640px)");
  const indent = wide ? INDENT.wide : INDENT.phone;
  const [drag, setDrag] = useState<Drag | null>(null);

  const tree = useMemo(() => buildTree(handlers.tasks), [handlers.tasks]);
  const rows = useMemo(() => {
    const hidden = new Set(handlers.collapsed);
    // The dragged task carries its subtasks; they are not rows of their own meanwhile.
    if (drag) hidden.add(drag.activeId);
    return flattenTree(tree, hidden);
  }, [tree, handlers.collapsed, drag]);

  const projected = drag
    ? projectListDrop(rows, drag.activeId, drag.overId, drag.offsetX, indent)
    : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const titleOf = (id: unknown) =>
    handlers.tasks.find((task) => task.id === String(id))?.title ?? "";
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("pickedUp", { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id
        ? t("over", { title: titleOf(active.id), target: titleOf(over.id) })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over ? t("dropped", { title: titleOf(active.id) }) : t("cancelled"),
    onDragCancel: () => t("cancelled"),
  };

  function onDragStart({ active }: DragStartEvent) {
    setDrag({ activeId: String(active.id), overId: String(active.id), offsetX: 0 });
  }

  function onDragMove({ delta }: DragMoveEvent) {
    setDrag((current) =>
      current && current.offsetX !== delta.x ? { ...current, offsetX: delta.x } : current,
    );
  }

  function onDragOver({ over }: DragOverEvent) {
    if (!over) return;
    setDrag((current) =>
      current && current.overId !== over.id ? { ...current, overId: String(over.id) } : current,
    );
  }

  function onDragEnd({ over }: DragEndEvent) {
    const landing = drag && over ? projected : null;
    const activeId = drag?.activeId;
    setDrag(null);
    if (landing && activeId) onMove(activeId, landing.target);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t("listInstructions") },
      }}
      onDragStart={handlers.readOnly ? undefined : onDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      <SortableContext
        items={rows.map((row) => row.task.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col" data-testid="task-list">
          {rows.map((row) => (
            <TaskRow
              key={row.task.id}
              row={row}
              depth={row.task.id === drag?.activeId && projected ? projected.depth : row.depth}
              indent={indent}
              handlers={handlers}
              dragging={drag !== null}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
