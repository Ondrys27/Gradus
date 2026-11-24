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
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useMediaQuery, useReducedMotionSafe } from "@/lib/use-media-query";
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
import { haptic, LIFT_SPRING } from "./motion";
import { WidgetFrame, type Arrival } from "./widget-frame";

/** Height of one row of the grid; two narrow columns get a little less. */
const ROW_HEIGHT = { [FULL_COLUMNS]: 164, [NARROW_COLUMNS]: 150 } as Record<number, number>;
const GAP_PX = 16;
const NO_STYLE: CSSProperties = {};
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
  // The effective settings keep their identity while the stored ones do, so
  // a reorder (new item objects) does not re-render the content of every widget.
  const cache = useRef<{
    by: (item: LayoutItem) => WidgetSettings;
    seen: Map<string, { stored: LayoutItem["settings"]; result: WidgetSettings }>;
  }>({ by: effective, seen: new Map() });
  if (cache.current.by !== effective) cache.current = { by: effective, seen: new Map() };
  return useMemo(
    () =>
      items.flatMap((item) => {
        const meta = widgetMeta(item.widget);
        if (!meta) return [];
        const seen = cache.current.seen;
        let entry = seen.get(item.id);
        if (!entry || entry.stored !== item.settings) {
          entry = { stored: item.settings, result: effective(item) };
          seen.set(item.id, entry);
        }
        return [
          {
            item,
            meta,
            name: t(`${meta.key}.name` as "today.name"),
            settings: entry.result,
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
  /** The widget just added: it flies in from its gallery preview. */
  arrival?: Arrival | null;
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
 * and a phone, by the width of the grid itself. In editing they wiggle, each
 * with its own phase, and move by dragging: the grabbed one lifts with a
 * shadow, the others make room with a spring as it passes over them (the
 * order changes live), and on drop it settles into the grid. A removed widget
 * shrinks away; a widget from the gallery flies in.
 */
export function WidgetGrid({
  entries,
  editing,
  scope,
  arrival = null,
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
  const reduceMotion = useReducedMotionSafe();
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
  const styles = useMemo(
    () =>
      new Map(
        [...placements.values()].map((p) => [
          p.id,
          { gridColumn: `${p.x + 1} / span ${p.w}`, gridRow: `${p.y + 1} / span ${p.h}` },
        ]),
      ),
    [placements],
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
    haptic("lift");
    onDragStart?.();
  }
  function over(event: DragOverEvent) {
    const overId = event.over ? String(event.over.id) : null;
    if (overId && overId !== String(event.active.id)) onDragOver?.(String(event.active.id), overId);
  }
  function end(event: DragEndEvent) {
    setActiveId(null);
    haptic("drop");
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
          <AnimatePresence initial={false}>
            {entries.map((entry) => {
              const p = placements.get(entry.item.id);
              if (!p) return null;
              return (
                <SortableWidget
                  key={entry.item.id}
                  entry={entry}
                  editing={editing}
                  scope={scope}
                  eager={p.y < EAGER_ROWS}
                  arrival={arrival}
                  style={styles.get(entry.item.id) ?? NO_STYLE}
                  onOpen={onOpen && entry.meta.detail !== false ? () => onOpen(entry) : undefined}
                  onLongPress={onLongPress}
                  onRemove={onRemove ? () => onRemove(entry) : undefined}
                  onResize={onResize ? (size) => onResize(entry, size) : undefined}
                  onSettings={onSettings ? () => onSettings(entry) : undefined}
                />
              );
            })}
          </AnimatePresence>
        </div>
      </SortableContext>
      <DragOverlay
        dropAnimation={
          reduceMotion ? null : { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
        }
      >
        {active ? (
          <motion.div
            initial={reduceMotion ? false : { scale: 1, rotate: 0 }}
            animate={{ scale: 1.05, rotate: 1.2 }}
            transition={LIFT_SPRING}
            className="h-full"
          >
            <WidgetFrame
              item={active.item}
              meta={active.meta}
              name={active.name}
              settings={active.settings}
              editing
              lifted
              scope={`${scope}-overlay`}
              eager
            />
          </motion.div>
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
  arrival,
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
  arrival: Arrival | null;
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
  // dnd-kit re-renders every sortable on each pointer move; the frame is
  // memoised, so it needs the same props as before unless something changed.
  const dragProps = useMemo(() => ({ ...attributes, ...listeners }), [attributes, listeners]);
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
      arrival={arrival}
      style={style}
      ghost={isDragging}
      onOpen={onOpen}
      onLongPress={onLongPress}
      onRemove={onRemove}
      onResize={onResize}
      onSettings={onSettings}
      dragProps={dragProps}
    />
  );
}
