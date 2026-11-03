"use client";

import {
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
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
import {
  ChevronDownIcon,
  CrownIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GripVerticalIcon,
  MoveIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { COMPANY_PATH } from "@/lib/routes";
import { useMediaQuery, useReducedMotionSafe } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { GroupChips, PersonCounts, PersonStatus } from "./person-bits";
import {
  flattenCompanyTree,
  OWNER_ROOT,
  planManagerMove,
  subtreeIds,
  type CompanyGroup,
  type CompanyNode,
  type CompanyPerson,
  type CompanyRow,
} from "./tree";

/** Who looks at the company: the owner (the root) or a worker (their branch). */
export type CompanyViewer =
  { kind: "owner"; name: string; avatarUrl: string | null } | { kind: "worker"; workerId: string };

export type CompanyViewProps = {
  /** The tree as shown (a group filter already applied). */
  root: CompanyNode;
  /** Everyone visible, for the move rules. */
  people: CompanyPerson[];
  groups: ReadonlyMap<string, CompanyGroup>;
  /** Shown faint: above a group's members, kept for the shape of the tree. */
  context: ReadonlySet<string> | null;
  viewer: CompanyViewer;
  /** The owner with a writable space: drag and "Move under…". */
  canEdit: boolean;
  /** The new manager: a worker's id, or null for right under the owner. */
  onMove: (workerId: string, managerId: string | null, via: "list" | "map") => void;
  onMoveMenu: (person: CompanyPerson) => void;
};

/** Px per level, capped so a deep tree still fits a phone. */
const INDENT = { phone: 16, wide: 28 } as const;
const MAX_INDENT_LEVELS = 10;

const noop = () => {};
/** Only events that start on the row itself, not in a menu it opened (portals bubble in React). */
const ownEvent = (event: SyntheticEvent) =>
  event.currentTarget.contains(event.target as Node | null);
const subscribeNever = () => noop;

export function isViewer(viewer: CompanyViewer, id: string) {
  return viewer.kind === "owner" ? id === OWNER_ROOT : id === viewer.workerId;
}

/**
 * The company as indented rows, the root first. A worker's row is dragged (on
 * a phone after a long press on the grip) onto another row, whose person
 * becomes their manager; the owner's row puts them right under the owner.
 * Their branch goes along. A drop the rules refuse lights up grey and does not
 * happen. "Move under…" in the row menu does the same without a pointer.
 */
export function CompanyList({
  root,
  people,
  groups,
  context,
  viewer,
  canEdit,
  onMove,
  onMoveMenu,
}: CompanyViewProps) {
  const t = useTranslations("workers.company");
  const wide = useMediaQuery("(min-width: 640px)");
  const reduceMotion = useReducedMotionSafe();
  const indent = wide ? INDENT.wide : INDENT.phone;
  const inBrowser = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [drag, setDrag] = useState<{ id: string; subtree: ReadonlySet<string> } | null>(null);
  const [over, setOver] = useState<{ id: string; valid: boolean } | null>(null);
  /** The click that ends a long press must not open the person it just dropped. */
  const justDragged = useRef(false);

  const rows = useMemo(() => flattenCompanyTree(root, collapsed), [root, collapsed]);
  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A long press, so a short swipe still scrolls the page.
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

  function toggle(id: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const dragged = drag ? byId.get(drag.id) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      autoScroll={{ threshold: { x: 0, y: 0.15 }, acceleration: 12 }}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t("move.instructions") },
      }}
      onDragStart={({ active }) => {
        justDragged.current = true;
        setDrag({ id: String(active.id), subtree: subtreeIds(people, String(active.id)) });
      }}
      onDragOver={onDragOver}
      onDragEnd={() => {
        const target = over;
        const id = drag?.id;
        finish();
        if (id && target?.valid) {
          onMove(id, target.id === OWNER_ROOT ? null : target.id, "list");
        }
      }}
      onDragCancel={finish}
    >
      <ul aria-label={t("list.label")} className="flex flex-col gap-0.5" data-testid="company-list">
        {rows.map((row) => (
          <CompanyListRow
            key={row.node.id}
            row={row}
            indent={indent}
            groups={groups}
            viewer={viewer}
            canEdit={canEdit}
            faint={context?.has(row.node.id) ?? false}
            dimmed={drag?.subtree.has(row.node.id) ?? false}
            dropState={over?.id === row.node.id ? (over.valid ? "ok" : "invalid") : null}
            justDragged={justDragged}
            onToggle={() => toggle(row.node.id)}
            onMoveMenu={onMoveMenu}
          />
        ))}
      </ul>
      {inBrowser &&
        createPortal(
          <DragOverlay dropAnimation={reduceMotion ? null : undefined}>
            {dragged && drag && <DragCard person={dragged} below={drag.subtree.size - 1} />}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

type RowProps = {
  row: CompanyRow;
  indent: number;
  groups: ReadonlyMap<string, CompanyGroup>;
  viewer: CompanyViewer;
  canEdit: boolean;
  faint: boolean;
  dimmed: boolean;
  dropState: "ok" | "invalid" | null;
  justDragged: RefObject<boolean>;
  onToggle: () => void;
  onMoveMenu: (person: CompanyPerson) => void;
};

function CompanyListRow({
  row,
  indent,
  groups,
  viewer,
  canEdit,
  faint,
  dimmed,
  dropState,
  justDragged,
  onToggle,
  onMoveMenu,
}: RowProps) {
  const t = useTranslations("workers.company");
  const tCard = useTranslations("workers.card");
  const settings = useFormatSettings();
  const { node, depth, below, collapsed } = row;
  const person = node.person;
  const isRoot = depth === 0;
  const draggable = useDraggable({ id: node.id, disabled: !canEdit || isRoot || !person });
  const droppable = useDroppable({ id: node.id, disabled: !canEdit || dimmed });
  const movable = canEdit && !isRoot && Boolean(person);
  const you = isViewer(viewer, node.id);
  const name = person?.name ?? (viewer.kind === "owner" ? viewer.name : "");
  const avatar =
    person?.avatarUrl ?? (viewer.kind === "owner" && !person ? viewer.avatarUrl : null);
  const opensDetail = viewer.kind === "owner" && person;
  const hasChildren = node.children.length > 0 || collapsed;

  const title = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-semibold text-ink">{name}</span>
      {you && (
        <span className="shrink-0 rounded-full bg-violet/20 px-1.5 text-[11px] font-semibold text-violet">
          {t("you")}
        </span>
      )}
      {!person && <CrownIcon aria-hidden className="size-3.5 shrink-0 text-gold" />}
    </span>
  );

  return (
    <li
      data-company-row={node.id}
      data-depth={depth}
      data-manager={person ? (person.managerId ?? OWNER_ROOT) : ""}
      style={{ paddingLeft: Math.min(depth, MAX_INDENT_LEVELS) * indent }}
      className={cn("transition-opacity", (dimmed || faint) && "opacity-45")}
    >
      <div
        ref={(element) => {
          droppable.setNodeRef(element);
          if (!isRoot) draggable.setNodeRef(element);
        }}
        // The whole row is dragged (after a long press on a phone); the grip shows it.
        onMouseDown={(event) => {
          if (movable && ownEvent(event)) draggable.listeners?.onMouseDown?.(event);
        }}
        onTouchStart={(event) => {
          if (movable && ownEvent(event)) draggable.listeners?.onTouchStart?.(event);
        }}
        className={cn(
          "flex min-h-14 items-center gap-1.5 rounded-xl border border-transparent pr-1 pl-1 transition-[background-color,box-shadow] hover:bg-surface-hover",
          movable && "cursor-grab touch-manipulation select-none [-webkit-touch-callout:none]",
          isRoot && "bg-surface/60",
          dropState === "ok" && "bg-gold/10 ring-2 ring-gold",
          dropState === "invalid" && "cursor-not-allowed ring-2 ring-line-strong",
        )}
      >
        {/* On a phone the long press works on the whole row; the grip would only take room. */}
        {movable ? (
          <span
            aria-hidden
            data-testid="company-drag-handle"
            className="hidden size-8 shrink-0 place-items-center rounded-lg text-ink-muted sm:grid"
          >
            <GripVerticalIcon className="size-4" />
          </span>
        ) : canEdit && !isRoot ? (
          <span aria-hidden className="hidden size-8 shrink-0 sm:block" />
        ) : null}

        {hasChildren ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? t("expand", { name }) : t("collapse", { name })}
            onClick={onToggle}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
          >
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-4 transition-transform motion-reduce:transition-none",
                collapsed && "-rotate-90",
              )}
            />
          </button>
        ) : (
          <span aria-hidden className="size-11 shrink-0 mouse:size-8" />
        )}

        <Avatar src={avatar} name={name} className="size-9" />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pl-1.5">
          {opensDetail ? (
            <Link
              href={`${COMPANY_PATH}/${node.id}`}
              draggable={false}
              onClick={(event) => {
                if (justDragged.current) event.preventDefault();
              }}
              className="min-w-0 rounded outline-none hover:underline focus-visible:ring-3 focus-visible:ring-violet/40"
            >
              {title}
            </Link>
          ) : (
            title
          )}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
            <span className="truncate">
              {person ? (person.jobTitle ?? tCard("noJobTitle")) : t("ownerRole")}
            </span>
            {collapsed && below > 0 && (
              <span className="rounded-full border border-line px-1.5 font-semibold text-ink-soft">
                {t("team", { count: below, shown: formatNumber(below, {}, settings) })}
              </span>
            )}
            {person && <PersonStatus status={person.status} />}
          </span>
          {person && person.groupIds.length > 0 && (
            <GroupChips groupIds={person.groupIds} groups={groups} className="pt-0.5" />
          )}
          {person && (
            <PersonCounts
              openTasks={person.openTasks}
              openDeals={person.openDeals}
              className="pt-0.5 sm:hidden"
            />
          )}
        </div>

        {person && (
          <PersonCounts
            openTasks={person.openTasks}
            openDeals={person.openDeals}
            className="hidden shrink-0 px-2 sm:flex"
          />
        )}

        {canEdit && person && !isRoot && (
          <RowMenu
            person={person}
            describedBy={draggable.attributes["aria-describedby"]}
            onMoveMenu={onMoveMenu}
          />
        )}
      </div>
    </li>
  );
}

function RowMenu({
  person,
  describedBy,
  onMoveMenu,
}: {
  person: CompanyPerson;
  describedBy?: string;
  onMoveMenu: (person: CompanyPerson) => void;
}) {
  const t = useTranslations("workers.company");
  const itemClass =
    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9 [&_svg]:size-4";
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("actions", { name: person.name })}
        aria-describedby={describedBy}
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-8"
      >
        <EllipsisIcon aria-hidden className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-popover">
          <Menu.Popup className="min-w-48 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
            <Menu.Item className={itemClass} onClick={() => onMoveMenu(person)}>
              <MoveIcon aria-hidden />
              {t("moveMenu")}
            </Menu.Item>
            <Menu.LinkItem
              closeOnClick
              render={<Link href={`${COMPANY_PATH}/${person.id}`} />}
              className={itemClass}
            >
              <ExternalLinkIcon aria-hidden />
              {t("openMenu")}
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The dragged worker as one card, carrying their team. */
export function DragCard({ person, below }: { person: CompanyPerson; below: number }) {
  const t = useTranslations("workers.company");
  const settings = useFormatSettings();
  return (
    <div className="flex min-h-11 w-max max-w-[min(100vw-32px,20rem)] cursor-grabbing items-center gap-2 rounded-xl border border-violet/70 bg-surface/95 px-3 py-1.5 shadow-glow-strong motion-safe:rotate-1">
      <GripVerticalIcon aria-hidden className="size-4 shrink-0 text-ink-muted" />
      <Avatar src={person.avatarUrl} name={person.name} className="size-7 text-[11px]" />
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">
        {person.name}
      </span>
      {below > 0 && (
        <span className="shrink-0 rounded-full border border-violet bg-canvas-deep px-2 py-0.5 text-xs font-semibold text-ink">
          {t("team", { count: below, shown: formatNumber(below, {}, settings) })}
        </span>
      )}
    </div>
  );
}
