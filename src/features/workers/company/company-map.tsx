"use client";

import {
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
  type TouchEvent,
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
  type DragOverEvent,
} from "@dnd-kit/core";
import { ChevronUpIcon, CrownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { TreeMap } from "@/components/tree-map/tree-map";
import { MAP_DRAG_NODE, type MapBranch } from "@/components/tree-map/tree-map-layout";
import { Avatar } from "@/components/ui/avatar";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { DragCard, isViewer, type CompanyViewProps } from "./company-list";
import { GroupChips, PersonCounts, PersonStatus } from "./person-bits";
import {
  OWNER_ROOT,
  planManagerMove,
  subtreeIds,
  type CompanyGroup,
  type CompanyNode,
  type CompanyPerson,
} from "./tree";

const noop = () => {};
const subscribeNever = () => noop;
const stop = (event: MouseEvent | TouchEvent) => event.stopPropagation();
/** Controls on a node never start dragging it. */
const keepFromDrag = { onMouseDown: stop, onTouchStart: stop } as const;

const cardBase =
  "relative flex w-56 flex-col gap-2 rounded-2xl border px-3 py-2.5 text-left transition-[border-color,opacity] duration-200";

function toBranch(node: CompanyNode): MapBranch {
  return { id: node.id, children: node.children.map(toBranch) };
}

/**
 * The organisation chart: the owner on top (a worker's own branch: them),
 * everyone under their manager below. A card is dragged (on a phone after a
 * long press) onto another card, whose person becomes the manager, or onto
 * the owner; the whole branch moves with it. One finger scrolls the page, two
 * move and zoom the map.
 */
export function CompanyMap({
  root,
  people,
  groups,
  context,
  viewer,
  canEdit,
  onMove,
  onOpen,
}: Omit<CompanyViewProps, "onMoveMenu">) {
  const t = useTranslations("workers.company");
  const reduceMotion = useReducedMotionSafe();
  const inBrowser = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const tree = useMemo(() => toBranch(root), [root]);
  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const [drag, setDrag] = useState<{
    id: string;
    subtree: ReadonlySet<string>;
    scale: number;
  } | null>(null);
  const [over, setOver] = useState<{ id: string; valid: boolean } | null>(null);
  const justDragged = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );

  const nameOf = (id: unknown) =>
    String(id) === OWNER_ROOT ? t("moveDialog.owner") : (byId.get(String(id))?.name ?? "");
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("move.pickedUp", { name: nameOf(active.id) }),
    onDragOver: ({ active, over: target }) =>
      target && target.id !== active.id
        ? t("move.over", { name: nameOf(active.id), target: nameOf(target.id) })
        : undefined,
    onDragEnd: ({ active, over: target }) =>
      target ? t("move.dropped", { name: nameOf(active.id) }) : t("move.cancelled"),
    onDragCancel: () => t("move.cancelled"),
  };

  // Everything a card shows, so the map measures again when any of it changes.
  const contentKey = useMemo(
    () =>
      JSON.stringify([
        people.map((p) => [p.id, p.name, p.jobTitle, p.status, p.groupIds, p.avatarUrl]),
        [...groups.values()].map((g) => [g.id, g.name, g.color]),
        viewer.kind === "owner" ? viewer.name : viewer.workerId,
      ]),
    [people, groups, viewer],
  );

  function finish() {
    setDrag(null);
    setOver(null);
    window.setTimeout(() => (justDragged.current = false), 80);
  }

  function onDragOver({ active, over: target }: DragOverEvent) {
    if (!target || target.id === active.id) {
      setOver(null);
      return;
    }
    const plan = planManagerMove(people, String(active.id), String(target.id));
    setOver({ id: String(target.id), valid: plan.ok && plan.changed });
  }

  function open(person: CompanyPerson) {
    if (justDragged.current) return;
    onOpen(person);
  }

  const map = (
    <TreeMap
      tree={tree}
      orientation="vertical"
      label={t("map.label")}
      contentKey={contentKey}
      locked={drag !== null}
      wrapNode={
        canEdit
          ? (id, node) => (
              <MapDragNode
                id={id}
                root={id === root.id}
                dimmed={drag?.subtree.has(id) ?? false}
                highlight={over?.id === id ? (over.valid ? "ok" : "invalid") : null}
              >
                {node}
              </MapDragNode>
            )
          : undefined
      }
      renderNode={(id, state) => {
        const person = id === OWNER_ROOT ? null : byId.get(id);
        const toggle = state.childCount > 0 && (
          <button
            type="button"
            {...keepFromDrag}
            onClick={(event) => {
              event.stopPropagation();
              state.onToggleCollapsed();
            }}
            aria-expanded={!state.collapsed}
            aria-label={
              state.collapsed
                ? t("expand", { name: person?.name ?? nameOf(OWNER_ROOT) })
                : t("collapse", { name: person?.name ?? nameOf(OWNER_ROOT) })
            }
            className={cn(
              "absolute top-full left-1/2 z-10 grid h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border bg-canvas-deep px-1.5 text-[11px] font-semibold text-ink-soft tabular-nums outline-none after:absolute after:-inset-2.5 after:content-[''] hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40",
              state.collapsed ? "border-violet text-ink" : "border-line-strong",
            )}
          >
            {state.collapsed ? (
              <CollapsedCount count={state.hiddenCount} />
            ) : (
              <ChevronUpIcon aria-hidden className="size-3.5" />
            )}
          </button>
        );
        if (!person) {
          return viewer.kind === "owner" ? (
            <OwnerCard name={viewer.name} avatarUrl={viewer.avatarUrl}>
              {toggle}
            </OwnerCard>
          ) : null;
        }
        return (
          <PersonCard
            person={person}
            groups={groups}
            you={isViewer(viewer, id)}
            faint={context?.has(id) ?? false}
            root={id === root.id}
            onOpen={state.measuring ? undefined : () => open(person)}
          >
            {toggle}
          </PersonCard>
        );
      }}
    />
  );

  if (!canEdit) return map;

  const dragged = drag ? byId.get(drag.id) : undefined;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      autoScroll={false}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t("move.instructions") },
      }}
      onDragStart={({ active }) => {
        const id = String(active.id);
        justDragged.current = true;
        const element = document.querySelector<HTMLElement>(`[data-map-drag="${CSS.escape(id)}"]`);
        const scale =
          element && element.offsetWidth > 0
            ? element.getBoundingClientRect().width / element.offsetWidth
            : 1;
        setDrag({ id, subtree: subtreeIds(people, id), scale });
      }}
      onDragOver={onDragOver}
      onDragEnd={() => {
        const target = over;
        const id = drag?.id;
        finish();
        if (id && target?.valid) onMove(id, target.id === OWNER_ROOT ? null : target.id, "map");
      }}
      onDragCancel={finish}
    >
      {map}
      {inBrowser &&
        createPortal(
          <DragOverlay dropAnimation={reduceMotion ? null : undefined}>
            {dragged && drag && (
              <div
                style={{ transform: `scale(${drag.scale})`, transformOrigin: "top left" }}
                className="w-max"
              >
                <DragCard person={dragged} below={drag.subtree.size - 1} />
              </div>
            )}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

function CollapsedCount({ count }: { count: number }) {
  const settings = useFormatSettings();
  return <>{`+${formatNumber(count, {}, settings)}`}</>;
}

function OwnerCard({
  name,
  avatarUrl,
  children,
}: {
  name: string;
  avatarUrl: string | null;
  children?: ReactNode;
}) {
  const t = useTranslations("workers.company");
  return (
    <div
      data-company-node={OWNER_ROOT}
      className={cn(
        cardBase,
        "border-violet bg-[color-mix(in_oklab,var(--color-violet)_18%,var(--color-surface))] shadow-glow-strong",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Avatar src={avatarUrl} name={name} className="size-10" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold text-ink">{name}</span>
            <span className="shrink-0 rounded-full bg-violet/25 px-1.5 text-[11px] font-semibold text-ink">
              {t("you")}
            </span>
          </span>
          <span className="flex items-center gap-1 text-xs text-ink-soft">
            <CrownIcon aria-hidden className="size-3.5 text-gold" />
            {t("ownerRole")}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

function PersonCard({
  person,
  groups,
  you,
  faint,
  root,
  onOpen,
  children,
}: {
  person: CompanyPerson;
  groups: ReadonlyMap<string, CompanyGroup>;
  you: boolean;
  faint: boolean;
  root: boolean;
  /** Absent in the measuring layer. */
  onOpen?: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations("workers.company");
  const tCard = useTranslations("workers.card");
  const header = (
    <span className="flex items-center gap-2.5">
      <Avatar src={person.avatarUrl} name={person.name} className="size-10" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold text-ink">{person.name}</span>
          {you && (
            <span className="shrink-0 rounded-full bg-violet/20 px-1.5 text-[11px] font-semibold text-violet">
              {t("you")}
            </span>
          )}
        </span>
        <span className="truncate text-xs text-ink-muted">
          {person.jobTitle ?? tCard("noJobTitle")}
        </span>
      </span>
    </span>
  );
  return (
    <div
      data-company-node={person.id}
      data-manager={person.managerId ?? OWNER_ROOT}
      className={cn(
        cardBase,
        root ? "border-violet/70 bg-surface shadow-glow" : "border-line-strong bg-surface",
        person.status === "inactive" && "border-dashed",
        faint && "opacity-45",
      )}
    >
      {onOpen ? (
        <button
          type="button"
          aria-label={t("open", { name: person.name })}
          onClick={onOpen}
          className="cursor-pointer rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
        >
          {header}
        </button>
      ) : (
        header
      )}
      <span className="flex items-center justify-between gap-2">
        <PersonCounts openTasks={person.openTasks} openDeals={person.openDeals} />
        {person.status !== "active" && <PersonStatus status={person.status} />}
      </span>
      <GroupChips groupIds={person.groupIds} groups={groups} max={2} />
      {children}
    </div>
  );
}

/** A card of the map that can be dragged (a worker) and dropped on (a worker or the owner). */
function MapDragNode({
  id,
  root,
  dimmed,
  highlight,
  children,
}: {
  id: string;
  root: boolean;
  /** Part of the dragged branch: no drop target, drawn faint. */
  dimmed: boolean;
  highlight: "ok" | "invalid" | null;
  children: ReactNode;
}) {
  const draggable = useDraggable({ id, disabled: root });
  const droppable = useDroppable({ id, disabled: dimmed });
  return (
    <div
      ref={(element) => {
        droppable.setNodeRef(element);
        if (!root) draggable.setNodeRef(element);
      }}
      data-map-drag={root ? undefined : id}
      aria-describedby={root ? undefined : draggable.attributes["aria-describedby"]}
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
      {highlight && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-1.5 rounded-[20px] border-2",
            highlight === "ok"
              ? "border-gold shadow-[0_0_28px_-6px_var(--color-gold)]"
              : "border-pink",
          )}
        />
      )}
      {children}
    </div>
  );
}
