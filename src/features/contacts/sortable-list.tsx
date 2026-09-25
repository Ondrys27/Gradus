"use client";

import type { ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type Item = { id: string };

type Props<T extends Item> = {
  items: T[];
  nameOf: (item: T) => string;
  onReorder: (activeId: string, overId: string) => void;
  renderItem: (item: T, handle: ReactNode) => ReactNode;
  className?: string;
};

/** A vertical list reordered by dragging a handle; works with touch and the keyboard. */
export function SortableList<T extends Item>({
  items,
  nameOf,
  onReorder,
  renderItem,
  className,
}: Props<T>) {
  const t = useTranslations("contacts.a11y");
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(items.map((item) => [item.id, item]));
  const name = (id: unknown) => {
    const item = byId.get(String(id));
    return item ? nameOf(item) : String(id);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("pickedUp", { name: name(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t("over", { name: name(active.id), target: name(over.id) }) : undefined,
    onDragEnd: ({ active, over }) =>
      over ? t("dropped", { name: name(active.id), target: name(over.id) }) : t("cancelled"),
    onDragCancel: () => t("cancelled"),
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("instructions") } }}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul className={cn("flex flex-col gap-2", className)}>
          {items.map((item) => (
            <SortableRow key={item.id} id={item.id} label={t("drag", { name: nameOf(item) })}>
              {(handle) => renderItem(item, handle)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const handle = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      aria-label={label}
      {...attributes}
      {...listeners}
      className="grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 active:cursor-grabbing mouse:size-8"
    >
      <GripVerticalIcon aria-hidden className="size-4" />
    </button>
  );

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-90")}
    >
      {children(handle)}
    </li>
  );
}
