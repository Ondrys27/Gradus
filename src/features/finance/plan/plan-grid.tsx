"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Menu } from "@base-ui/react/menu";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  EllipsisIcon,
  FileTextIcon,
  GripVerticalIcon,
  HandshakeIcon,
  PencilIcon,
  RepeatIcon,
  Trash2Icon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDayMonth, formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { decimalMarkOf, parseAmountInput } from "./amount-input";
import type { PipelineSuggestion } from "./carry-over";
import type { ModelRow, MonthModel } from "./month-model";
import type { CellChange } from "./queries";
import type { PlanKind, PlanSource, PlanView } from "./sheet";

const SOURCE_ICONS: Partial<Record<PlanSource, LucideIcon>> = {
  contact: UserIcon,
  deal: HandshakeIcon,
  recurring: RepeatIcon,
  invoice: FileTextIcon,
};

type Props = {
  model: MonthModel;
  view: PlanView;
  opening: number;
  /** Finance "write", not read-only, the month not closed. */
  canEdit: boolean;
  onSaveCell: (change: CellChange) => void;
  onSaveOpening: (value: number) => void;
  /** Resolves with the new row's id, or null when it could not be made. */
  onAddRow: (kind: PlanKind, label: string) => Promise<string | null>;
  /** Resolves false when the name was refused (it stays in editing). */
  onRenameRow: (id: string, label: string) => Promise<boolean>;
  onDeleteRow: (row: ModelRow) => void;
  onMoveRow: (kind: PlanKind, activeId: string, overId: string) => void;
  onOpenCell: (rowId: string, kind: PlanKind, label: string, week: number) => void;
  onAcceptSuggestion: (suggestion: PipelineSuggestion) => void;
};

type GridLine =
  | { key: string; type: "opening" }
  | { key: string; type: "row"; row: ModelRow }
  | { key: string; type: "other"; row: ModelRow }
  | { key: string; type: "total"; kind: PlanKind }
  | { key: string; type: "balance" }
  | { key: string; type: "closing" };

type Active = { line: string; col: number };
type Editing = Active & { draft: string; invalid: boolean };

/** Whole amounts without decimals, others with two; nothing for an empty cell. */
function useAmount() {
  const settings = useFormatSettings();
  return (value: number, blankZero = false) =>
    blankZero && value === 0
      ? ""
      : formatNumber(value, { decimals: Number.isInteger(value) ? 0 : 2 }, settings);
}

export function PlanGrid(props: Props) {
  const { model, view, canEdit } = props;
  const t = useTranslations("finance.plan.grid");
  const settings = useFormatSettings();
  const amount = useAmount();
  const decimal = decimalMarkOf(settings.numberLocale);
  const weeks = model.weeks.length;
  const editable = canEdit && view === "plan";
  const [active, setActive] = useState<Active | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const lines = useMemo<GridLine[]>(() => {
    const result: GridLine[] = [{ key: "opening", type: "opening" }];
    for (const kind of ["income", "expense"] as const) {
      for (const row of model.rows[kind]) result.push({ key: `row:${row.id}`, type: "row", row });
      const other = model.other[kind];
      if (other) result.push({ key: `other:${kind}`, type: "other", row: other });
      result.push({ key: `total:${kind}`, type: "total", kind });
    }
    result.push({ key: "balance", type: "balance" }, { key: "closing", type: "closing" });
    return result;
  }, [model]);
  const lineIndex = useMemo(() => new Map(lines.map((line, index) => [line.key, index])), [lines]);

  const isEditableCell = (line: GridLine | undefined, col: number) =>
    Boolean(line) &&
    editable &&
    ((line!.type === "opening" && col === 0) || line!.type === "row");
  const isOpenableCell = (line: GridLine | undefined) =>
    Boolean(line) && view !== "plan" && (line!.type === "row" || line!.type === "other");

  // The focused cell follows the active one (keyboard users never lose their place).
  useEffect(() => {
    if (!active || editing) return;
    const cell = tableRef.current?.querySelector<HTMLElement>(
      `[data-cell="${globalThis.CSS.escape(`${active.line}|${active.col}`)}"]`,
    );
    if (cell && document.activeElement !== cell) cell.focus({ preventScroll: false });
  }, [active, editing]);

  function lineValue(line: GridLine, col: number): number {
    switch (line.type) {
      case "opening":
        return col < weeks ? model.sheet.opening.weeks[col] : model.sheet.opening.total;
      case "row":
      case "other":
        return col < weeks ? line.row.shown[col] : line.row.total;
      case "total": {
        const totals = model.sheet[line.kind];
        return col < weeks ? totals.weeks[col] : totals.total;
      }
      case "balance":
        return col < weeks ? model.sheet.balance.weeks[col] : model.sheet.balance.total;
      case "closing":
        return col < weeks ? model.sheet.closing.weeks[col] : model.sheet.closing.total;
    }
  }

  function startEditing(line: GridLine, col: number, draft?: string) {
    if (!isEditableCell(line, col)) return;
    const current = line.type === "opening" ? props.opening : line.type === "row" ? line.row.plan[col] : 0;
    setActive({ line: line.key, col });
    setEditing({
      line: line.key,
      col,
      draft: draft ?? (current === 0 ? "" : String(current).replace(".", decimal)),
      invalid: false,
    });
  }

  function move(from: Active, rows: number, cols: number) {
    let index = (lineIndex.get(from.line) ?? 0) + rows;
    index = Math.max(0, Math.min(lines.length - 1, index));
    const col = Math.max(0, Math.min(weeks, from.col + cols));
    setActive({ line: lines[index].key, col });
  }

  // Enter or Tab commit and unmount the input, whose blur would commit again.
  const committed = useRef<Editing | null>(null);

  function commit(next?: { rows: number; cols: number }): boolean {
    if (!editing || committed.current === editing) return true;
    const line = lines[lineIndex.get(editing.line) ?? -1];
    const parsed = parseAmountInput(editing.draft, decimal);
    if (!parsed.ok) {
      setEditing({ ...editing, invalid: true });
      return false;
    }
    const value = parsed.value ?? 0;
    const expression = /[*/×x+()]|\d\s*[-−]/i.test(editing.draft.replace(/^\s*[-−]/, ""));
    if (line?.type === "opening") {
      if (value !== props.opening) props.onSaveOpening(value);
    } else if (line?.type === "row") {
      if (value !== line.row.plan[editing.col]) {
        props.onSaveCell({ rowId: line.row.id, kind: line.row.kind, week: editing.col + 1, value, expression });
      }
    }
    const at = { line: editing.line, col: editing.col };
    committed.current = editing;
    setEditing(null);
    if (next) move(at, next.rows, next.cols);
    else setActive(at);
    return true;
  }

  function onCellKeyDown(event: KeyboardEvent<HTMLElement>, line: GridLine, col: number) {
    if (editing) return;
    const here = { line: line.key, col };
    const keys: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (keys[event.key]) {
      event.preventDefault();
      move(here, keys[event.key][0], keys[event.key][1]);
      return;
    }
    if (event.key === "Tab") {
      if ((event.shiftKey && col === 0) || (!event.shiftKey && col === weeks)) return;
      event.preventDefault();
      move(here, 0, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      if (isEditableCell(line, col)) startEditing(line, col);
      else if (isOpenableCell(line) && col < weeks && line.type !== "opening") {
        openCell(line, col);
      } else move(here, event.shiftKey ? -1 : 1, 0);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && isEditableCell(line, col)) {
      event.preventDefault();
      if (line.type === "opening") props.onSaveOpening(0);
      else if (line.type === "row" && line.row.plan[col] !== 0) {
        props.onSaveCell({ rowId: line.row.id, kind: line.row.kind, week: col + 1, value: null, expression: false });
      }
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && isEditableCell(line, col)) {
      event.preventDefault();
      startEditing(line, col, event.key);
    }
  }

  function openCell(line: GridLine, col: number) {
    if (line.type !== "row" && line.type !== "other") return;
    const label = line.type === "other" ? t("other") : line.row.label;
    props.onOpenCell(line.row.id, line.row.kind, label, col + 1);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      const at = editing && { line: editing.line, col: editing.col };
      committed.current = editing;
      setEditing(null);
      if (at) setActive(at);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit({ rows: event.shiftKey ? -1 : 1, cols: 0 });
    } else if (event.key === "Tab") {
      event.preventDefault();
      commit({ rows: 0, cols: event.shiftKey ? -1 : 1 });
    }
  }

  function cell(line: GridLine, col: number, options: { strong?: boolean } = {}): ReactNode {
    const value = lineValue(line, col);
    const isEditing = editing?.line === line.key && editing.col === col;
    const isActive = active?.line === line.key && active.col === col;
    const canType = isEditableCell(line, col);
    const canOpen = isOpenableCell(line) && col < weeks;
    const entered = view === "plan" && (line.type === "row" || (line.type === "opening" && col === 0));
    const blankZero = line.type === "row" || line.type === "other";
    const small =
      view === "plan" &&
      line.type === "row" &&
      col < weeks &&
      col < model.pastWeeks &&
      line.row.actual &&
      (line.row.actual[col] !== 0 || line.row.plan[col] !== 0)
        ? line.row.actual[col]
        : null;
    const rowName =
      line.type === "row" ? line.row.label : line.type === "other" ? t("other") : t(line.type === "total" ? `${line.kind}Total` : line.type);
    const columnName = col < weeks ? t("week", { week: col + 1 }) : t("total");
    const first = !active && line.type === "opening" && col === 0;
    return (
      <td
        key={col}
        data-cell={`${line.key}|${col}`}
        role="gridcell"
        tabIndex={isActive || first ? 0 : -1}
        aria-label={`${rowName}, ${columnName}`}
        aria-readonly={!canType}
        onKeyDown={(event) => onCellKeyDown(event, line, col)}
        onFocus={() => {
          if (!isActive && !editing) setActive({ line: line.key, col });
        }}
        onClick={() => {
          if (canType) startEditing(line, col);
          else if (canOpen) openCell(line, col);
          else setActive({ line: line.key, col });
        }}
        className={cn(
          "relative h-11 min-w-26 border-b border-line/60 px-2 text-right align-middle tabular-nums outline-none mouse:h-9",
          col === weeks && "border-l border-line/60",
          model.currentWeek === col + 1 && "bg-violet/5",
          (canType || canOpen) && "cursor-pointer hover:bg-surface-hover",
          isActive && !isEditing && "ring-2 ring-violet/70 ring-inset",
          options.strong && "font-semibold",
        )}
      >
        {isEditing ? (
          <input
            autoFocus
            inputMode="decimal"
            enterKeyHint="next"
            aria-label={`${rowName}, ${columnName}`}
            aria-invalid={editing.invalid || undefined}
            title={editing.invalid ? t("invalidNumber") : undefined}
            value={editing.draft}
            onFocus={(event) => {
              if (editing.draft.length > 1) event.currentTarget.select();
            }}
            onChange={(event) => setEditing({ ...editing, draft: event.target.value, invalid: false })}
            onKeyDown={onInputKeyDown}
            onBlur={() => {
              if (!commit()) setEditing(null);
            }}
            className={cn(
              "absolute inset-0.5 w-[calc(100%-4px)] rounded-md border bg-canvas-deep px-2 text-right text-violet tabular-nums outline-none",
              editing.invalid ? "border-pink" : "border-violet",
            )}
          />
        ) : (
          <span className="flex flex-col items-end leading-tight">
            <span
              className={cn(
                value < 0 ? "text-pink" : entered ? "text-violet" : "text-ink",
                line.type === "other" && "text-ink-soft",
              )}
            >
              {amount(value, blankZero)}
            </span>
            {small !== null && (
              <span className="text-[11px] text-ink-muted" title={t("actualHint", { value: amount(small) })}>
                {amount(small)}
              </span>
            )}
          </span>
        )}
      </td>
    );
  }

  const weekCells = (line: GridLine, options?: { strong?: boolean }) =>
    Array.from({ length: weeks + 1 }, (_, col) => cell(line, col, options));
  const lineOf = (key: string) => lines[lineIndex.get(key) ?? -1];
  const sticky = "sticky left-0 z-[1] bg-surface";

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface" data-testid="finance-plan-grid">
      <table ref={tableRef} role="grid" aria-label={t("label")} className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className={cn(sticky, "min-w-44 border-b border-line px-3 py-2 text-left font-medium text-ink-soft")}>
              <span className="sr-only">{t("item")}</span>
            </th>
            {model.weeks.map((week) => (
              <th
                key={week.week}
                scope="col"
                className={cn(
                  "border-b border-line px-2 py-2 text-right font-medium whitespace-nowrap text-ink-soft",
                  model.currentWeek === week.week && "bg-violet/5 text-ink",
                )}
              >
                <span className="block">{t("week", { week: week.week })}</span>
                <span className="block text-[11px] font-normal text-ink-muted">
                  {formatDayMonth(week.start, settings)} – {formatDayMonth(week.end, settings)}
                </span>
              </th>
            ))}
            <th scope="col" className="border-b border-l border-line px-2 py-2 text-right font-medium text-ink-soft">
              {t("total")}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className={cn(sticky, "border-b border-line/60 px-3 text-left font-semibold text-ink")}>
              {t("opening")}
            </th>
            {weekCells(lineOf("opening"), { strong: true })}
          </tr>
        </tbody>
        {(["income", "expense"] as const).map((kind) => (
          <Block
            key={kind}
            kind={kind}
            model={model}
            canEdit={editable}
            sticky={sticky}
            weeks={weeks}
            onMoveRow={props.onMoveRow}
            onAddRow={async (label) => {
              const id = await props.onAddRow(kind, label);
              if (id) setActive({ line: `row:${id}`, col: 0 });
              return id !== null;
            }}
            onRenameRow={props.onRenameRow}
            onDeleteRow={props.onDeleteRow}
            onAcceptSuggestion={props.onAcceptSuggestion}
            renderCells={(key, strong) => weekCells(lineOf(key), { strong })}
          />
        ))}
        <tbody>
          <tr>
            <th
              scope="rowgroup"
              colSpan={weeks + 2}
              className={cn(sticky, "px-3 pt-4 pb-1 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase")}
            >
              {t("capital")}
            </th>
          </tr>
          <tr>
            <th scope="row" className={cn(sticky, "border-b border-line/60 px-3 text-left font-semibold text-ink")}>
              {t("balance")}
            </th>
            {weekCells(lineOf("balance"), { strong: true })}
          </tr>
          <tr>
            <th scope="row" className={cn(sticky, "px-3 text-left font-semibold text-ink")}>
              {t("closing")}
            </th>
            {weekCells(lineOf("closing"), { strong: true })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Block({
  kind,
  model,
  canEdit,
  sticky,
  weeks,
  onMoveRow,
  onAddRow,
  onRenameRow,
  onDeleteRow,
  onAcceptSuggestion,
  renderCells,
}: {
  kind: PlanKind;
  model: MonthModel;
  canEdit: boolean;
  sticky: string;
  weeks: number;
  onMoveRow: Props["onMoveRow"];
  onAddRow: (label: string) => Promise<boolean>;
  onRenameRow: Props["onRenameRow"];
  onDeleteRow: Props["onDeleteRow"];
  onAcceptSuggestion: Props["onAcceptSuggestion"];
  renderCells: (key: string, strong?: boolean) => ReactNode;
}) {
  const t = useTranslations("finance.plan.grid");
  const amount = useAmount();
  const dndId = useId();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const rows = model.rows[kind];
  const other = model.other[kind];
  const suggestions = kind === "income" ? model.suggestions : [];

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id) onMoveRow(kind, String(active.id), String(over.id));
  }

  return (
    <tbody>
      <tr>
        <th
          scope="rowgroup"
          colSpan={weeks + 2}
          className={cn(sticky, "px-3 pt-4 pb-1 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase")}
        >
          {t(kind)}
        </th>
      </tr>
      <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
          {rows.map((row) => (
            <SortableLine key={row.id} id={row.id} disabled={!canEdit}>
              {(handle, style, ref) => (
                <tr ref={ref} style={style}>
                  <RowLabel
                    row={row}
                    sticky={sticky}
                    handle={handle}
                    canEdit={canEdit}
                    onRename={onRenameRow}
                    onDelete={onDeleteRow}
                  />
                  {renderCells(`row:${row.id}`)}
                </tr>
              )}
            </SortableLine>
          ))}
        </SortableContext>
      </DndContext>
      {suggestions.map((suggestion) => (
        <tr key={suggestion.dealId} className="text-ink-muted">
          <th scope="row" className={cn(sticky, "border-b border-line/60 px-3 text-left font-normal")}>
            <span className="flex items-center gap-2">
              <HandshakeIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate italic">
                {suggestion.label}
                <span className="block text-[11px] not-italic">{t("pipelineHeading")}</span>
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onAcceptSuggestion(suggestion)}
                  aria-label={t("acceptLabel", { name: suggestion.label })}
                  className="h-11 shrink-0 cursor-pointer rounded-lg px-2 text-xs font-medium text-violet outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-7"
                >
                  {t("accept")}
                </button>
              )}
            </span>
          </th>
          {Array.from({ length: weeks + 1 }, (_, col) => (
            <td
              key={col}
              className={cn(
                "h-11 border-b border-line/60 px-2 text-right italic tabular-nums mouse:h-9",
                col === weeks && "border-l border-line/60",
              )}
            >
              {col === weeks || col === suggestion.week - 1 ? amount(suggestion.amount) : ""}
            </td>
          ))}
        </tr>
      ))}
      {canEdit && <NewRow kind={kind} sticky={sticky} weeks={weeks} onAdd={onAddRow} />}
      {other && (
        <tr>
          <th scope="row" className={cn(sticky, "border-b border-line/60 px-3 text-left font-normal text-ink-soft")}>
            {t("other")}
          </th>
          {renderCells(`other:${kind}`)}
        </tr>
      )}
      <tr>
        <th scope="row" className={cn(sticky, "border-b border-line px-3 text-left font-semibold text-ink")}>
          {t(`${kind}Total`)}
        </th>
        {renderCells(`total:${kind}`, true)}
      </tr>
    </tbody>
  );
}

function SortableLine({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (handle: ReactNode, style: CSSProperties, ref: (node: HTMLElement | null) => void) => ReactNode;
}) {
  const t = useTranslations("finance.plan.grid");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: isDragging ? "relative" : undefined,
    zIndex: isDragging ? 2 : undefined,
  };
  const handle = disabled ? null : (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={t("drag")}
      className="grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-6 mouse:opacity-0 mouse:group-hover/row:opacity-100 mouse:focus-visible:opacity-100"
    >
      <GripVerticalIcon aria-hidden className="size-4" />
    </button>
  );
  return <>{children(handle, style, setNodeRef)}</>;
}

function RowLabel({
  row,
  sticky,
  handle,
  canEdit,
  onRename,
  onDelete,
}: {
  row: ModelRow;
  sticky: string;
  handle: ReactNode;
  canEdit: boolean;
  onRename: Props["onRenameRow"];
  onDelete: Props["onDeleteRow"];
}) {
  const t = useTranslations("finance.plan.grid");
  const [renaming, setRenaming] = useState<string | null>(null);
  const Icon = SOURCE_ICONS[row.source];

  async function save() {
    if (renaming === null) return;
    const label = renaming.trim();
    if (!label || label === row.label) {
      setRenaming(null);
      return;
    }
    if (await onRename(row.id, label.slice(0, 120))) setRenaming(null);
  }

  const itemClass =
    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9 [&_svg]:size-4";

  return (
    <th scope="row" className={cn(sticky, "group/row border-b border-line/60 px-1 text-left font-normal text-ink")}>
      <div className="flex items-center gap-1">
        {handle}
        {renaming !== null ? (
          <input
            autoFocus
            value={renaming}
            maxLength={120}
            aria-label={t("rename")}
            onChange={(event) => setRenaming(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRenaming(null);
              }
            }}
            onBlur={() => void save()}
            className="h-9 min-w-0 flex-1 rounded-md border border-violet bg-canvas-deep px-2 text-sm text-ink outline-none"
          />
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2">
            {Icon && <Icon aria-label={t(`source.${row.source}`)} className="size-3.5 shrink-0 text-ink-muted" />}
            <span className="truncate" title={row.label}>
              {row.label}
            </span>
          </span>
        )}
        {canEdit && renaming === null && (
          <Menu.Root>
            <Menu.Trigger
              aria-label={t("rowMenu", { name: row.label })}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 data-popup-open:opacity-100 mouse:size-7 mouse:opacity-0 mouse:group-hover/row:opacity-100 mouse:focus-visible:opacity-100"
            >
              <EllipsisIcon aria-hidden className="size-4" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={4} align="start" className="z-popover">
                <Menu.Popup className="min-w-44 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
                  <Menu.Item className={itemClass} onClick={() => setRenaming(row.label)}>
                    <PencilIcon aria-hidden />
                    {t("rename")}
                  </Menu.Item>
                  <Menu.Item className={cn(itemClass, "text-pink")} onClick={() => onDelete(row)}>
                    <Trash2Icon aria-hidden />
                    {t("delete")}
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}
      </div>
    </th>
  );
}

/** The empty line above the total: typing a name makes a new row. */
function NewRow({
  kind,
  sticky,
  weeks,
  onAdd,
}: {
  kind: PlanKind;
  sticky: string;
  weeks: number;
  onAdd: (label: string) => Promise<boolean>;
}) {
  const t = useTranslations("finance.plan.grid");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const name = label.trim();
    if (!name || busy) return;
    setBusy(true);
    const ok = await onAdd(name.slice(0, 120));
    setBusy(false);
    if (ok) setLabel("");
  }

  return (
    <tr>
      <th scope="row" className={cn(sticky, "border-b border-line/60 px-1 font-normal")}>
        <input
          value={label}
          maxLength={120}
          disabled={busy}
          placeholder={t("newRow")}
          aria-label={t(kind === "income" ? "newIncome" : "newExpense")}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void add();
            } else if (event.key === "Escape") setLabel("");
          }}
          onBlur={() => void add()}
          className="h-11 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm text-ink outline-none placeholder:text-ink-muted hover:border-line focus:border-violet mouse:h-9"
        />
      </th>
      <td colSpan={weeks + 1} className="border-b border-line/60" />
    </tr>
  );
}
