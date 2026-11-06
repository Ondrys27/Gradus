"use client";

import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type TouchEvent,
} from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronLeftIcon, ExternalLinkIcon, SparklesIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { KIND_ICONS } from "@/features/search/use-search-rows";
import { track } from "@/lib/analytics/client";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { mentionHref } from "../mention-queries";
import type { MentionTarget } from "../mentions";
import type { BranchColor, MapNode } from "./map-doc";

/** Shared by the visible node and its hidden twin in the measuring layer. */
const cardBase =
  "relative flex w-max max-w-[288px] min-w-[120px] flex-col gap-1 rounded-2xl border px-3.5 py-2.5 text-left";
const rootBase = "min-w-[160px] max-w-[320px] px-4 py-3";
const titleBase = "text-sm leading-snug [overflow-wrap:anywhere] whitespace-pre-wrap";
const rootTitle = "font-display text-base font-semibold";

/** Branch colours as static classes, so Tailwind sees every name. */
const COLOR_BORDER: Record<BranchColor, string> = {
  violet: "border-violet/55",
  teal: "border-teal/55",
  gold: "border-gold/55",
  green: "border-green/55",
  orange: "border-orange/55",
  pink: "border-pink/55",
};
export const COLOR_FILL: Record<BranchColor, string> = {
  violet: "bg-violet",
  teal: "bg-teal",
  gold: "bg-gold",
  green: "bg-green",
  orange: "bg-orange",
  pink: "bg-pink",
};

/** A tap that moved further than this was a pan, not a tap. */
const TAP_SLOP = 8;

const stop = (event: MouseEvent | PointerEvent | TouchEvent | KeyboardEvent) =>
  event.stopPropagation();
/** Controls and the text field never start dragging the node (the drag sensors listen to these). */
const keepFromDrag = { onMouseDown: stop, onTouchStart: stop, onPointerDown: stop } as const;

const miniButton =
  "relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-full outline-none after:absolute after:-inset-2 after:content-[''] focus-visible:ring-3 focus-visible:ring-violet/40";

type Editing = {
  value: string;
  max: number;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur: () => void;
};

export type NoteMapNodeProps = {
  node: MapNode;
  root: boolean;
  color: BranchColor | null;
  /** The hidden twin that is measured: same size, no handlers. */
  measuring: boolean;
  selected: boolean;
  /** The title being typed; the field is shown instead of the text. */
  editing: Editing | null;
  /** The current state of the linked record, when the link is a record. */
  target?: MentionTarget;
  childCount: number;
  hiddenCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: () => void;
  onStartEdit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Keep or delete a suggestion; absent when read-only. */
  onAccept?: () => void;
  onReject?: () => void;
};

function LinkChip({
  node,
  target,
  interactive,
}: {
  node: MapNode;
  target?: MentionTarget;
  interactive: boolean;
}) {
  const t = useTranslations("notes");
  const router = useRouter();
  const settings = useFormatSettings();
  const link = node.link;
  if (!link) return null;
  const chip =
    "inline-flex max-w-full items-center gap-1 self-start rounded-md px-1.5 py-0.5 text-xs font-medium";

  if (link.type === "url") {
    let host = link.href;
    try {
      host = new URL(link.href).hostname.replace(/^www\./, "") || link.href;
    } catch {
      // A stored address is always a URL; the text stays as it is otherwise.
    }
    return interactive ? (
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        {...keepFromDrag}
        onClick={stop}
        data-testid="note-map-link"
        className={cn(chip, "bg-teal/12 text-teal outline-none hover:bg-teal/20 focus-visible:ring-2 focus-visible:ring-teal/50")}
      >
        <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{host}</span>
      </a>
    ) : (
      <span className={cn(chip, "bg-teal/12 text-teal")}>
        <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{host}</span>
      </span>
    );
  }

  const { type, id, label: stored } = link.attrs;
  const Icon = KIND_ICONS[type];
  const label = (target?.exists ? target.label : stored) || t("mention.unnamed");
  if (target?.exists === false) {
    return (
      <span
        title={t("mention.missing")}
        aria-label={t("mention.missingLabel", { label })}
        className={cn(chip, "bg-surface text-ink-muted")}
      >
        <Icon aria-hidden className="size-3 shrink-0" />
        <s className="truncate">{label}</s>
      </span>
    );
  }
  if (!interactive) {
    return (
      <span className={cn(chip, "bg-violet/14 text-ink")}>
        <Icon aria-hidden className="size-3 shrink-0 text-violet" />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      title={t(`mention.open.${type}`)}
      {...keepFromDrag}
      onClick={(event) => {
        event.stopPropagation();
        track("note_mention_opened", { target: type });
        router.push(mentionHref(type, id, settings, target?.exists ? target.startsAt : null));
      }}
      data-testid="note-map-mention"
      className={cn(
        chip,
        "cursor-pointer bg-violet/14 text-ink outline-none hover:bg-violet/24 focus-visible:ring-2 focus-visible:ring-violet/50",
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0 text-violet" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function TitleField({ editing, root }: { editing: Editing; root: boolean }) {
  const t = useTranslations("notes.map");
  const ref = useRef<HTMLTextAreaElement>(null);
  // Into the field at once, the caret at the end; the map is not scrolled by the browser.
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);
  const placeholder = root ? t("rootPlaceholder") : t("nodePlaceholder");
  return (
    <span className="grid">
      {/* The text sizes the field, so it is exactly as large as the measured twin. */}
      <span aria-hidden className={cn(titleBase, root && rootTitle, "invisible col-start-1 row-start-1")}>
        {(editing.value || placeholder) + " "}
      </span>
      <textarea
        ref={ref}
        rows={1}
        value={editing.value}
        maxLength={editing.max}
        placeholder={placeholder}
        aria-label={t("titleLabel")}
        data-testid="note-map-input"
        spellCheck
        onChange={(event) => editing.onChange(event.target.value.replace(/\n/g, " "))}
        onKeyDown={editing.onKeyDown}
        onBlur={editing.onBlur}
        onClick={stop}
        onDoubleClick={stop}
        {...keepFromDrag}
        className={cn(
          titleBase,
          root && rootTitle,
          "col-start-1 row-start-1 resize-none overflow-hidden border-0 bg-transparent p-0 text-ink outline-none placeholder:text-ink-muted",
        )}
      />
    </span>
  );
}

/** One node of a map note: its title (or the field to type it), small note, link chip and colour. */
export function NoteMapNode({
  node,
  root,
  color,
  measuring,
  selected,
  editing,
  target,
  childCount,
  hiddenCount,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onStartEdit,
  onKeyDown,
  onAccept,
  onReject,
}: NoteMapNodeProps) {
  const t = useTranslations("notes.map");
  const settings = useFormatSettings();
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const suggested = !!node.suggested;
  const placeholder = root ? t("rootPlaceholder") : t("nodePlaceholder");
  const text = editing ? editing.value : node.title;

  const card = cn(
    cardBase,
    root && rootBase,
    suggested
      ? "border-dashed border-line-strong bg-surface/40 text-ink-muted"
      : root
        ? "border-violet/45 bg-violet/14"
        : cn("bg-surface", color ? COLOR_BORDER[color] : "border-line-strong"),
  );

  if (measuring) {
    return (
      <div className={card}>
        <span className={cn(titleBase, root && rootTitle)}>
          {suggested && !editing && <SparklesIcon aria-hidden className="mr-1 inline size-3.5" />}
          {(text || placeholder) + (editing ? " " : "")}
        </span>
        {node.note && <span className="line-clamp-3 text-xs text-ink-muted">{node.note}</span>}
        {node.link && <LinkChip node={node} target={target} interactive={false} />}
        {suggested && <span className="h-7" />}
      </div>
    );
  }

  function click(event: MouseEvent) {
    const start = pressedAt.current;
    pressedAt.current = null;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) return;
    onSelect();
  }

  return (
    <div
      data-testid="note-map-node"
      data-node-id={node.id}
      data-suggested={suggested ? "" : undefined}
      onPointerDown={(event) => (pressedAt.current = { x: event.clientX, y: event.clientY })}
      onClick={click}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onStartEdit();
      }}
      className={cn(card, "group cursor-pointer transition-[border-color,background-color] duration-200")}
    >
      {selected && (
        // Drawn here, not by the map, so selecting never remounts the node (focus, double click).
        <span
          aria-hidden
          data-map-capture-skip=""
          className="pointer-events-none absolute -inset-1.5 z-10 rounded-[20px] border-2 border-teal shadow-[0_0_24px_-6px_var(--color-teal)]"
        />
      )}
      {color && !root && !suggested && (
        <span
          aria-hidden
          className={cn("absolute top-2.5 bottom-2.5 left-1 w-1 rounded-full", COLOR_FILL[color])}
        />
      )}
      {editing ? (
        <TitleField editing={editing} root={root} />
      ) : (
        <button
          type="button"
          data-note-map-node={node.id}
          aria-pressed={selected}
          aria-label={node.title || placeholder}
          onKeyDown={onKeyDown}
          onClick={(event) => {
            event.stopPropagation();
            click(event);
          }}
          className={cn(
            titleBase,
            root && rootTitle,
            "cursor-pointer rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
            node.title ? (suggested ? "text-ink-soft" : "text-ink") : "text-ink-muted",
          )}
        >
          {suggested && <SparklesIcon aria-hidden className="mr-1 inline size-3.5 align-[-2px] text-ink-muted" />}
          {node.title || placeholder}
        </button>
      )}
      {node.note && <span className="line-clamp-3 text-xs text-ink-muted">{node.note}</span>}
      {node.link && <LinkChip node={node} target={target} interactive />}

      {suggested && onAccept && onReject && (
        <span className="flex items-center gap-1" {...keepFromDrag} onClick={stop}>
          <button
            type="button"
            onClick={onAccept}
            aria-label={t("suggestions.acceptOne", { title: node.title })}
            title={t("suggestions.accept")}
            data-testid="note-map-accept"
            className={cn(miniButton, "text-green hover:bg-green/12")}
          >
            <CheckIcon aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={onReject}
            aria-label={t("suggestions.rejectOne", { title: node.title })}
            title={t("suggestions.reject")}
            data-testid="note-map-reject"
            className={cn(miniButton, "text-pink hover:bg-pink/12")}
          >
            <XIcon aria-hidden className="size-4" />
          </button>
        </span>
      )}

      {childCount > 0 && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapsed();
          }}
          {...keepFromDrag}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("expand", { count: hiddenCount }) : t("collapse")}
          className={cn(
            "absolute top-1/2 left-full z-10 grid h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border bg-canvas-deep px-1 text-[11px] font-semibold text-ink-soft tabular-nums outline-none after:absolute after:-inset-2.5 after:content-[''] hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40",
            collapsed ? "border-violet text-ink" : "border-line-strong",
          )}
        >
          {collapsed ? (
            `+${formatNumber(hiddenCount, {}, settings)}`
          ) : (
            <ChevronLeftIcon aria-hidden className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

/** The floating copy of a node while it is dragged. */
export function NoteMapDragPreview({
  node,
  color,
  below,
  scale,
}: {
  node: MapNode;
  color: BranchColor | null;
  below: number;
  scale: number;
}) {
  const t = useTranslations("notes.map");
  const settings = useFormatSettings();
  return (
    <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }} className="w-max">
      <div
        className={cn(
          cardBase,
          "cursor-grabbing bg-surface shadow-glow-strong motion-safe:rotate-2",
          color ? COLOR_BORDER[color] : "border-violet/70",
        )}
      >
        <span className={cn(titleBase, "text-ink")}>{node.title || t("nodePlaceholder")}</span>
        {below > 0 && (
          <span className="text-xs text-ink-muted tabular-nums">
            {t("dragBelow", { count: below, formatted: formatNumber(below, {}, settings) })}
          </span>
        )}
      </div>
    </div>
  );
}
