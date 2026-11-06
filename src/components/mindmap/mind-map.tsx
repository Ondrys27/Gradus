"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type ReactNode,
} from "react";
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
import { FileUpIcon } from "lucide-react";
import { TreeMap, type TreeMapNodeState } from "@/components/tree-map/tree-map";
import {
  MAP_DRAG_NODE,
  type MapBranch,
  type Orientation,
} from "@/components/tree-map/tree-map-layout";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import {
  indexBranches,
  mapDropZone,
  moveDirectionOf,
  type MapDropZone,
  type MindMapDirection,
} from "./mind-map-tree";

export type { TreeMapNodeState as MindMapNodeState };

/** What a drop means for the screen's data: a target to move to, and whether its rules allow it. */
export type MindMapDrop<T> = { target: T; valid: boolean };

export type MindMapDragTexts = {
  pickedUp: (title: string) => string;
  over: (title: string, target: string) => string;
  dropped: (title: string) => string;
  cancelled: () => string;
  /** Read by screen readers on a draggable node. */
  instructions: string;
};

/** Dragging nodes onto, before and after each other; absent = the map is look only. */
export type MindMapDrag<T> = {
  /**
   * The meaning of the node `activeId` over `overId` (the root's id = the
   * first level) in a zone; the root is always "inside". Null = nowhere.
   */
  resolve: (activeId: string, overId: string, zone: MapDropZone) => MindMapDrop<T> | null;
  /** Every drop with a target, also an invalid one (the screen says why it did not happen). */
  onDrop: (activeId: string, target: T) => void;
  /** ⌘/Ctrl + arrows on a focused node. */
  onKeyMove?: (id: string, direction: MindMapDirection) => void;
  /** The floating copy while dragging, `below` nodes travelling with it, at the map's zoom. */
  renderPreview: (id: string, info: { below: number; scale: number }) => ReactNode;
  titleOf: (id: string) => string;
  texts: MindMapDragTexts;
  /**
   * Set while a drag ends: the click that ends a long press comes right after
   * the drop and must not open the node it just dropped.
   */
  justDragged?: { current: boolean };
};

type Props<T> = {
  tree: MapBranch;
  label: string;
  contentKey: unknown;
  renderNode: (id: string, state: TreeMapNodeState) => ReactNode;
  overlay?: ReactNode;
  orientation?: Orientation;
  drag?: MindMapDrag<T>;
  /** A node drawn as selected (after an import: the root); focused when the map aligns. */
  selectedId?: string | null;
  /** Any press in the map ends the selection. */
  onSelectedChange?: (id: string | null) => void;
  /** A new value (not undefined) fits the whole map into view and focuses the selected node. */
  alignKey?: unknown;
  onAligned?: () => void;
  /** A file dropped onto the map (e.g. a mind map to import); `fileDropLabel` is shown meanwhile. */
  onFileDrop?: (file: File) => void;
  fileDropLabel?: string;
};

const noop = () => {};
const subscribeNever = () => noop;

/** Where the dragged node would land: over a node in a zone. */
type Hint = { overId: string; zone: MapDropZone; valid: boolean };
type Drag = { id: string; subtree: ReadonlySet<string>; scale: number };

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

/**
 * A mind map: the tree map (layout from measured sizes, zoom and pan, full
 * screen, collapsing, reduced motion) plus what every editable map shares,
 * with data that knows nothing of tasks or notes: dragging a node (on a phone
 * after a long press) onto, before or after another with its subtree, ⌘/Ctrl
 * + arrows, a selected node, aligning on request and dropping a file onto it.
 * The task map of a milestone uses it; notes will too.
 */
export function MindMap<T>({
  tree,
  label,
  contentKey,
  renderNode,
  overlay,
  orientation,
  drag: dragConfig,
  selectedId = null,
  onSelectedChange,
  alignKey,
  onAligned: afterAligned,
  onFileDrop,
  fileDropLabel,
}: Props<T>) {
  const reduceMotion = useReducedMotionSafe();
  const rootRef = useRef<HTMLDivElement>(null);
  const { parents, branches } = useMemo(() => indexBranches(tree), [tree]);
  // The overlay goes to <body>, which exists only in the browser.
  const inBrowser = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const [drag, setDrag] = useState<Drag | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  /** Read when the drop happens: a drop that cannot happen floats back to its place. */
  const [floatBack, setFloatBack] = useState(true);
  const [fileOver, setFileOver] = useState(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A long press, so a short swipe still scrolls the page or moves the map.
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );

  const subtreeOf = useCallback(
    (id: string) => {
      const found = new Set<string>();
      const stack = branches.has(id) ? [branches.get(id)!] : [];
      while (stack.length) {
        const branch = stack.pop()!;
        found.add(branch.id);
        stack.push(...branch.children);
      }
      return found;
    },
    [branches],
  );

  const onAligned = useCallback(() => {
    if (selectedId) {
      rootRef.current
        ?.querySelector<HTMLElement>(`[data-mindmap-node="${CSS.escape(selectedId)}"]`)
        ?.focus({ preventScroll: true });
    }
    afterAligned?.();
  }, [selectedId, afterAligned]);

  const titleOf = (id: unknown) => dragConfig?.titleOf(String(id)) ?? "";
  const announcements: Announcements | undefined = dragConfig && {
    onDragStart: ({ active }) => dragConfig.texts.pickedUp(titleOf(active.id)),
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id
        ? dragConfig.texts.over(titleOf(active.id), titleOf(over.id))
        : undefined,
    onDragEnd: ({ active, over }) =>
      over ? dragConfig.texts.dropped(titleOf(active.id)) : dragConfig.texts.cancelled(),
    onDragCancel: () => dragConfig.texts.cancelled(),
  };

  const ownJustDragged = useRef(false);
  const justDragged = dragConfig?.justDragged ?? ownJustDragged;

  function onDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    justDragged.current = true;
    // The node is drawn scaled with the map; the floating copy keeps that size.
    const element = document.querySelector<HTMLElement>(`[data-map-drag="${CSS.escape(id)}"]`);
    const scale =
      element && element.offsetWidth > 0
        ? element.getBoundingClientRect().width / element.offsetWidth
        : 1;
    setDrag({ id, subtree: subtreeOf(id), scale });
    setHint(null);
  }

  function onDragMove({ active, over, activatorEvent, delta }: DragMoveEvent) {
    const start = getEventCoordinates(activatorEvent);
    if (!over || !start || !dragConfig) {
      if (hint) setHint(null);
      return;
    }
    const overId = String(over.id);
    const zone = overId === tree.id ? "inside" : mapDropZone(over.rect, start.y + delta.y);
    if (hint && hint.overId === overId && hint.zone === zone) return;
    const drop = dragConfig.resolve(String(active.id), overId, zone);
    setHint({ overId, zone, valid: Boolean(drop?.valid) });
  }

  function finish() {
    setDrag(null);
    setHint(null);
    // The click that ends a long press comes right after the drop.
    window.setTimeout(() => (justDragged.current = false), 80);
  }

  function onDragEnd() {
    const drop = drag && hint ? dragConfig?.resolve(drag.id, hint.overId, hint.zone) : null;
    const id = drag?.id;
    setFloatBack(!(drop && hint?.valid));
    finish();
    if (id && drop) dragConfig?.onDrop(id, drop.target);
  }

  // The parent the dragged node would land under, and the sibling it lands next to.
  const parentHighlight =
    hint === null
      ? undefined
      : hint.zone === "inside"
        ? hint.overId
        : (parents.get(hint.overId) ?? tree.id);
  const line = hint && hint.zone !== "inside" ? { id: hint.overId, side: hint.zone } : null;
  const canDrag = Boolean(dragConfig);
  const wraps = canDrag || selectedId !== null;

  const map = (
    <TreeMap
      tree={tree}
      label={label}
      contentKey={contentKey}
      overlay={overlay}
      orientation={orientation}
      locked={drag !== null}
      alignKey={alignKey}
      onAligned={onAligned}
      wrapNode={
        wraps
          ? (id, node) => {
              const selected = selectedId === id;
              const body = canDrag ? (
                <MapDragNode
                  id={id}
                  root={id === tree.id}
                  dimmed={drag?.subtree.has(id) ?? false}
                  highlight={parentHighlight === id ? (hint?.valid ? "ok" : "invalid") : null}
                  line={line?.id === id ? (line.side as "before" | "after") : null}
                  lineValid={hint?.valid ?? true}
                  onKeyMove={(direction) => dragConfig?.onKeyMove?.(id, direction)}
                >
                  {node}
                </MapDragNode>
              ) : (
                node
              );
              if (!selected) return body;
              return (
                <div
                  data-mindmap-node={id}
                  data-selected=""
                  tabIndex={-1}
                  className="relative rounded-2xl outline-none"
                >
                  <span
                    aria-hidden
                    data-map-capture-skip=""
                    className="pointer-events-none absolute -inset-1.5 z-10 rounded-[20px] border-2 border-teal shadow-[0_0_24px_-6px_var(--color-teal)]"
                  />
                  {body}
                </div>
              );
            }
          : undefined
      }
      renderNode={renderNode}
    />
  );

  const withFiles = onFileDrop ? (
    <div
      ref={rootRef}
      className="relative"
      onPointerDownCapture={() => selectedId !== null && onSelectedChange?.(null)}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setFileOver(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setFileOver(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setFileOver(false);
        const file = event.dataTransfer.files[0];
        if (file) onFileDrop(file);
      }}
    >
      {map}
      {fileOver && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-violet bg-canvas/80 backdrop-blur-sm"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <FileUpIcon aria-hidden className="size-5 text-violet" />
            {fileDropLabel}
          </span>
        </div>
      )}
    </div>
  ) : (
    <div
      ref={rootRef}
      className="contents"
      onPointerDownCapture={() => selectedId !== null && onSelectedChange?.(null)}
    >
      {map}
    </div>
  );

  if (!dragConfig) return withFiles;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      autoScroll={false}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: dragConfig.texts.instructions },
      }}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setFloatBack(true);
        finish();
      }}
    >
      {withFiles}
      {inBrowser &&
        createPortal(
          // A real drop lets the map glide the node to its new place.
          <DragOverlay dropAnimation={floatBack && !reduceMotion ? undefined : null}>
            {drag &&
              dragConfig.renderPreview(drag.id, {
                below: drag.subtree.size - 1,
                scale: drag.scale,
              })}
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
  /** The parent the dragged node would land under. */
  highlight: "ok" | "invalid" | null;
  /** The dragged node would land right before or after this one. */
  line: "before" | "after" | null;
  lineValid: boolean;
  onKeyMove: (direction: MindMapDirection) => void;
  children: ReactNode;
};

/** A node of the map that can be dragged (not the root) and dropped on. */
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
