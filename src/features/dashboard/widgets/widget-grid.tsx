"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { widgetMeta, type WidgetMeta } from "./catalog";
import {
  arrange,
  columnsFor,
  FULL_COLUMNS,
  NARROW_COLUMNS,
  type LayoutItem,
  type WidgetSize,
} from "./grid";
import type { WidgetSettings } from "./kit";
import { WidgetFrame } from "./widget-frame";

/** Height of one row of the grid; two narrow columns get a little less. */
const ROW_HEIGHT = { [FULL_COLUMNS]: 164, [NARROW_COLUMNS]: 150 } as Record<number, number>;
const GAP_PX = 16;
/** Widgets of the first rows load at once; the rest when they scroll near. */
const EAGER_ROWS = 4;

/** Measured width of the grid → its columns; before measuring, a guess from the window. */
function useColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const wide = useMediaQuery("(min-width: 1024px)");
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      // Never keep a zero width (a hidden tab measures 0).
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const cols = width === null ? (wide ? FULL_COLUMNS : NARROW_COLUMNS) : columnsFor(width);
  return { ref, cols };
}

export type GridEntry = {
  item: LayoutItem;
  meta: WidgetMeta;
  name: string;
  /** The settings with choices the account may not make replaced (access.ts). */
  settings: WidgetSettings;
};

export function useGridEntries(
  items: readonly LayoutItem[],
  effective: (item: LayoutItem) => WidgetSettings,
): GridEntry[] {
  const t = useTranslations("dashboard.widgets");
  return useMemo(
    () =>
      items.flatMap((item) => {
        const meta = widgetMeta(item.widget);
        if (!meta) return [];
        return [
          {
            item,
            meta,
            name: t(`${meta.key}.name` as "today.name"),
            settings: effective(item),
          },
        ];
      }),
    [items, effective, t],
  );
}

type Props = {
  entries: GridEntry[];
  editing: boolean;
  scope: string;
  /** The widget just added: it flies in. */
  fresh?: string | null;
  onOpen?: (entry: GridEntry) => void;
  onLongPress?: () => void;
  onRemove?: (entry: GridEntry) => void;
  onResize?: (entry: GridEntry, size: WidgetSize) => void;
  onSettings?: (entry: GridEntry) => void;
  /** A drag began: the order before it, to commit or cancel against. */
  onDragStart?: () => void;
  /** The dragged widget is over another one: take its place (shown at once). */
  onDragOver?: (activeId: string, overId: string) => void;
  onDragEnd?: (commit: boolean, activeId: string) => void;
};

const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

/**
 * The widgets on the grid (28.5): four columns on a computer, two on a tablet
 * and a phone, by the width of the grid itself. In editing they wiggle and
 * move by dragging; the others make room as the dragged one passes over them
 * (the order changes live, and every widget glides to its new place).
 */
export function WidgetGrid({
  entries,
  editing,
  scope,
  fresh = null,
  onOpen,
  onLongPress,
  onRemove,
  onResize,
  onSettings,
  onDragStart,
  onDragOver,
  onDragEnd,
}: Props) {
  const t = useTranslations("dashboard.board");
  const { ref, cols } = useColumns();
  const placements = useMemo(
    () =>
      new Map(
        arrange(
          entries.map((entry) => entry.item),
          cols,
        ).map((p) => [p.id, p]),
      ),
    [entries, cols],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const active = entries.find((entry) => entry.item.id === activeId) ?? null;
  const rowHeight = ROW_HEIGHT[cols];

  function start(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    onDragStart?.();
  }
  function over(event: DragOverEvent) {
    const overId = event.over ? String(event.over.id) : null;
    if (overId && overId !== String(event.active.id)) onDragOver?.(String(event.active.id), overId);
  }
  function end(event: DragEndEvent) {
    setActiveId(null);
    onDragEnd?.(true, String(event.active.id));
  }
  function cancel() {
    const id = activeId;
    setActiveId(null);
    if (id) onDragEnd?.(false, id);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={start}
      onDragOver={over}
      onDragEnd={end}
      onDragCancel={cancel}
      accessibility={{
        screenReaderInstructions: { draggable: t("dragInstructions") },
      }}
    >
      <SortableContext items={entries.map((entry) => entry.item.id)} strategy={() => null}>
        <div
          ref={ref}
          data-testid="widget-grid"
          data-tutorial="dashboard-widgets"
          data-cols={cols}
          data-editing={editing ? "true" : undefined}
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridAutoRows: `${rowHeight}px`,
            gap: GAP_PX,
          }}
        >
          {entries.map((entry, index) => {
            const p = placements.get(entry.item.id);
            if (!p) return null;
            return (
              <SortableWidget
                key={entry.item.id}
                entry={entry}
                editing={editing}
                scope={scope}
                eager={p.y < EAGER_ROWS}
                fresh={fresh === entry.item.id}
                wiggleDelay={-((index * 0.13) % 0.34)}
                style={{
                  gridColumn: `${p.x + 1} / span ${p.w}`,
                  gridRow: `${p.y + 1} / span ${p.h}`,
                }}
                onOpen={onOpen && entry.meta.detail !== false ? () => onOpen(entry) : undefined}
                onLongPress={onLongPress}
                onRemove={onRemove ? () => onRemove(entry) : undefined}
                onResize={onResize ? (size) => onResize(entry, size) : undefined}
                onSettings={onSettings ? () => onSettings(entry) : undefined}
              />
            );
          })}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }}>
        {active ? (
          <WidgetFrame
            item={active.item}
            meta={active.meta}
            name={active.name}
            settings={active.settings}
            editing
            scope={`${scope}-overlay`}
            eager
            className={cn("rotate-1 shadow-glow-strong", "scale-[1.03]")}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableWidget({
  entry,
  editing,
  scope,
  eager,
  fresh,
  wiggleDelay,
  style,
  onOpen,
  onLongPress,
  onRemove,
  onResize,
  onSettings,
}: {
  entry: GridEntry;
  editing: boolean;
  scope: string;
  eager: boolean;
  fresh: boolean;
  wiggleDelay: number;
  style: CSSProperties;
  onOpen?: () => void;
  onLongPress?: () => void;
  onRemove?: () => void;
  onResize?: (size: WidgetSize) => void;
  onSettings?: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: entry.item.id,
    disabled: !editing,
  });
  return (
    <WidgetFrame
      ref={setNodeRef}
      item={entry.item}
      meta={entry.meta}
      name={entry.name}
      settings={entry.settings}
      editing={editing}
      scope={scope}
      eager={eager}
      fresh={fresh}
      wiggleDelay={wiggleDelay}
      style={style}
      ghost={isDragging}
      onOpen={onOpen}
      onLongPress={onLongPress}
      onRemove={onRemove}
      onResize={onResize}
      onSettings={onSettings}
      dragProps={{ ...attributes, ...listeners }}
    />
  );
}
