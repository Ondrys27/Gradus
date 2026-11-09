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
  ArrowRightIcon,
  CheckIcon,
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

/** The three first steps of a fresh month; the guide shows until all are done. */
export type GuideState = { opening: boolean; income: boolean; expense: boolean };
const GUIDE_STEPS = ["opening", "income", "expense"] as const;

type Props = {
  model: MonthModel;
  view: PlanView;
  opening: number;
  currency: string;
  /** Finance "write", not read-only, the month not closed. */
  canEdit: boolean;
  /** Null hides the guide (a month that is already going, or no right to edit). */
  guide?: GuideState | null;
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

/** The first column sticks left; it must be opaque, so tinted rows carry the tint themselves. */
const STICKY = "sticky left-0 z-[1] bg-surface";
const STICKY_TINT = "sticky left-0 z-[1] plan-row-tint";
const CELL_HEIGHT = "h-11 mouse:h-9";
const FLASH_MS = 1000;

export function PlanGrid(props: Props) {
  const { model, view, canEdit, currency, guide = null } = props;
  const t = useTranslations("finance.plan.grid");
  const settings = useFormatSettings();
  const amount = useAmount();
  const decimal = decimalMarkOf(settings.numberLocale);
  const weeks = model.weeks.length;
  const editable = canEdit && view === "plan";
  const [active, setActive] = useState<Active | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const showGuide = editable && guide !== null && GUIDE_STEPS.some((step) => !guide[step]);

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

  // After a typed number the cells it recomputed light up for a moment: the
  // computed values are remembered, and the ones that differ after the user's
  // own change get a fresh flash (a loaded month or a changed view never flashes).
  const computedSnapshot = useRef<{ scope: string; values: Map<string, number> } | null>(null);
  const userChanged = useRef(false);
  const [flashes, setFlashes] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    const scope = `${model.month}|${view}`;
    const next = new Map<string, number>();
    for (const line of lines) {
      for (let col = 0; col <= weeks; col += 1) {
        if (isEditableCell(line, col)) continue;
        next.set(`${line.key}|${col}`, lineValue(line, col));
      }
    }
    // Another month or view starts over: nothing there was recomputed by the user.
    const previous = computedSnapshot.current?.scope === scope ? computedSnapshot.current.values : null;
    computedSnapshot.current = { scope, values: next };
    if (!userChanged.current || !previous) return;
    userChanged.current = false;
    const changed = [...next].filter(([key, value]) => previous.has(key) && previous.get(key) !== value);
    if (changed.length === 0) return;
    const stamp = Date.now();
    setFlashes((current) => {
      const map = new Map(current);
      for (const [key] of changed) map.set(key, stamp);
      return map;
    });
    const timer = setTimeout(
      () =>
        setFlashes((current) => {
          const map = new Map(current);
          for (const [key, at] of current) if (at === stamp) map.delete(key);
          return map;
        }),
      FLASH_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the snapshot follows the model only
  }, [model, view, lines, weeks]);

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
      if (value !== props.opening) {
        userChanged.current = true;
        props.onSaveOpening(value);
      }
    } else if (line?.type === "row") {
      if (value !== line.row.plan[editing.col]) {
        userChanged.current = true;
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
      if (line.type === "opening") {
        if (props.opening !== 0) userChanged.current = true;
        props.onSaveOpening(0);
      } else if (line.type === "row" && line.row.plan[col] !== 0) {
        userChanged.current = true;
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

  /** The guide's steps lead into the cell or the name field they talk about. */
  function goToStep(step: (typeof GUIDE_STEPS)[number]) {
    if (step === "opening") {
      startEditing(lines[0], 0);
      return;
    }
    tableRef.current?.querySelector<HTMLInputElement>(`[data-new-row="${step}"]`)?.focus();
  }

  const lowest = view !== "diff" ? model.sheet.summary : null;
  const isPastCol = (col: number) => col < weeks && col < model.pastWeeks;
  const isCurrentCol = (col: number) => model.currentWeek === col + 1;

  function cell(line: GridLine, col: number, options: { strong?: boolean; topLine?: boolean } = {}): ReactNode {
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
      isPastCol(col) &&
      line.row.actual &&
      (line.row.actual[col] !== 0 || line.row.plan[col] !== 0)
        ? line.row.actual[col]
        : null;
    const lowestCell =
      line.type === "closing" && lowest !== null && lowest.warning !== null && col === lowest.lowest.week - 1;
    const rowName =
      line.type === "row" ? line.row.label : line.type === "other" ? t("other") : t(line.type === "total" ? `${line.kind}Total` : line.type);
    const columnName = col < weeks ? t("week", { week: col + 1 }) : t("total");
    const first = !active && line.type === "opening" && col === 0;
    const flash = flashes.get(`${line.key}|${col}`);
    return (
      <td
        key={col}
        data-cell={`${line.key}|${col}`}
        role="gridcell"
        tabIndex={isActive || first ? 0 : -1}
        aria-label={`${rowName}, ${columnName}`}
        aria-readonly={!canType}
        title={lowestCell ? t("lowestCell") : undefined}
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
          "relative min-w-26 border-b border-line/60 px-2 text-right align-middle tabular-nums outline-none",
          CELL_HEIGHT,
          col === weeks && "border-l border-line",
          isCurrentCol(col) && "bg-ink/4",
          options.topLine && "border-t border-line-strong",
          (canType || canOpen) && "cursor-pointer hover:bg-surface-hover",
          isActive && !isEditing && "ring-2 ring-violet/70 ring-inset",
          options.strong && "font-semibold",
          lowestCell && "bg-pink/12",
        )}
      >
        {flash !== undefined && (
          <span
            key={flash}
            aria-hidden
            className="pointer-events-none absolute inset-0.5 rounded-md motion-safe:animate-plan-flash"
          />
        )}
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
          <span className={cn("relative flex flex-col items-end leading-tight", isPastCol(col) && "opacity-65")}>
            <span
              className={cn(
                value < 0 || lowestCell ? "text-pink" : entered ? "text-violet" : "text-ink",
                line.type === "other" && "text-ink-soft",
                lowestCell && "font-semibold",
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

  const weekCells = (line: GridLine, options?: { strong?: boolean; topLine?: boolean }) =>
    Array.from({ length: weeks + 1 }, (_, col) => cell(line, col, options));
  const lineOf = (key: string) => lines[lineIndex.get(key) ?? -1];
  const headerCell = "sticky top-0 z-[2] border-t-2 border-b border-b-line bg-surface px-2 py-2 text-right font-medium whitespace-nowrap";

  return (
    <div
      className="overflow-auto rounded-card border border-line bg-surface md:max-h-[calc(100dvh-9rem)]"
      data-testid="finance-plan-grid"
    >
      <table
        ref={tableRef}
        role="grid"
        aria-label={t("label")}
        className="w-full border-separate border-spacing-0 text-sm"
      >
        <thead>
          <tr>
            <th
              scope="col"
              className={cn(
                headerCell,
                "left-0 z-[3] min-w-44 border-t-transparent px-3 text-left text-xs font-normal text-ink-muted",
              )}
            >
              <span className="sr-only">{t("item")}. </span>
              {t("amountsIn", { currency })}
            </th>
            {model.weeks.map((week) => {
              const current = model.currentWeek === week.week;
              const past = week.week <= model.pastWeeks;
              return (
                <th
                  key={week.week}
                  scope="col"
                  className={cn(
                    headerCell,
                    current ? "border-t-ink/70 bg-ink/4 text-ink" : "border-t-transparent text-ink-soft",
                    past && "opacity-65",
                  )}
                >
                  <span className="block">
                    {t("week", { week: week.week })}
                    {current && <span className="sr-only"> ({t("currentWeek")})</span>}
                    {past && <span className="sr-only"> ({t("pastWeek")})</span>}
                  </span>
                  <span className="block text-[11px] font-normal text-ink-muted">
                    {formatDayMonth(week.start, settings)} – {formatDayMonth(week.end, settings)}
                  </span>
                </th>
              );
            })}
            <th scope="col" className={cn(headerCell, "border-l border-line border-t-transparent text-ink-soft")}>
              {t("total")}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className={cn(STICKY, "border-b border-line/60 px-3 text-left font-semibold text-ink")}>
              {t("opening")}
            </th>
            {weekCells(lineOf("opening"), { strong: true })}
          </tr>
          {showGuide && guide && (
            <tr data-testid="finance-plan-guide">
              <td colSpan={weeks + 2} className="border-b border-line/60 px-2 py-1.5">
                <ol aria-label={t("guide.label")} className="sticky left-2 flex w-max max-w-[calc(100vw-3rem)] flex-wrap items-center gap-y-1 text-sm">
                  {GUIDE_STEPS.map((step, index) => {
                    const done = guide[step];
                    const next = !done && GUIDE_STEPS.slice(0, index).every((earlier) => guide[earlier]);
                    return (
                      <li key={step} className="flex items-center">
                        {index > 0 && <ArrowRightIcon aria-hidden className="mx-1 size-3.5 shrink-0 text-ink-muted" />}
                        <button
                          type="button"
                          onClick={() => goToStep(step)}
                          aria-current={next ? "step" : undefined}
                          className={cn(
                            "flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 outline-none focus-visible:ring-3 focus-visible:ring-violet/40",
                            done
                              ? "text-ink-muted"
                              : next
                                ? "bg-violet/12 font-medium text-violet hover:bg-violet/18"
                                : "text-ink-soft hover:bg-surface-hover",
                          )}
                        >
                          {done ? (
                            <CheckIcon aria-label={t("guide.done")} className="size-4 text-green" />
                          ) : (
                            <span
                              aria-hidden
                              className={cn(
                                "grid size-5 place-items-center rounded-full border text-[11px] font-semibold",
                                next ? "border-violet/60" : "border-line-strong",
                              )}
                            >
                              {index + 1}
                            </span>
                          )}
                          <span className={cn(done && "line-through decoration-ink-muted/60")}>{t(`guide.${step}`)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </td>
            </tr>
          )}
        </tbody>
        {(["income", "expense"] as const).map((kind) => (
          <Block
            key={kind}
            kind={kind}
            model={model}
            canEdit={editable}
            weeks={weeks}
            currentCol={isCurrentCol}
            onMoveRow={props.onMoveRow}
            onAddRow={async (label) => {
              const id = await props.onAddRow(kind, label);
              if (id) setActive({ line: `row:${id}`, col: 0 });
              return id !== null;
            }}
            onRenameRow={props.onRenameRow}
            onDeleteRow={props.onDeleteRow}
            onAcceptSuggestion={props.onAcceptSuggestion}
            renderCells={(key, options) => weekCells(lineOf(key), options)}
          />
        ))}
        <tbody>
          <tr>
            <th scope="rowgroup" colSpan={weeks + 2} className={cn(STICKY, "px-3 pt-4 pb-1 text-left text-xs font-semibold text-ink-soft")}>
              {t("capital")}
            </th>
          </tr>
          <tr>
            <th scope="row" className={cn(STICKY, "border-b border-line/60 px-3 text-left font-medium text-ink")}>
              {t("balance")}
            </th>
            {weekCells(lineOf("balance"))}
          </tr>
          <tr>
            <th scope="row" className={cn(STICKY, "border-t border-line-strong px-3 text-left font-semibold text-ink")}>
              {t("closing")}
            </th>
            {weekCells(lineOf("closing"), { strong: true, topLine: true })}
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
  weeks,
  currentCol,
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
  weeks: number;
  currentCol: (col: number) => boolean;
  onMoveRow: Props["onMoveRow"];
  onAddRow: (label: string) => Promise<boolean>;
  onRenameRow: Props["onRenameRow"];
  onDeleteRow: Props["onDeleteRow"];
  onAcceptSuggestion: Props["onAcceptSuggestion"];
  renderCells: (key: string, options?: { strong?: boolean; topLine?: boolean }) => ReactNode;
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
        <th scope="rowgroup" colSpan={weeks + 2} className={cn(STICKY, "px-3 pt-4 pb-1 text-left text-xs font-semibold text-ink-soft")}>
          {t(kind)}
        </th>
      </tr>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        // The screen-reader text is a <div>, which may not sit inside <tbody>;
        // dnd-kit renders it only after mount, so the server never needs `document`.
        accessibility={{ container: typeof document === "undefined" ? undefined : document.body }}
      >
        <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
          {rows.map((row) => (
            <SortableLine key={row.id} id={row.id} disabled={!canEdit}>
              {(handle, style, ref) => (
                <tr ref={ref} style={style} className="plan-row-tint">
                  <RowLabel
                    row={row}
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
        <tr key={suggestion.dealId} className="plan-row-tint text-ink-muted">
          <th scope="row" className={cn(STICKY_TINT, "border-b border-line/60 px-3 text-left font-normal")}>
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
                "border-b border-line/60 px-2 text-right italic tabular-nums",
                CELL_HEIGHT,
                col === weeks && "border-l border-line",
                currentCol(col) && "bg-ink/4",
              )}
            >
              {col === weeks || col === suggestion.week - 1 ? amount(suggestion.amount) : ""}
            </td>
          ))}
        </tr>
      ))}
      {canEdit && <NewRow kind={kind} weeks={weeks} currentCol={currentCol} onAdd={onAddRow} />}
      {other && (
        <tr className="plan-row-tint">
          <th scope="row" className={cn(STICKY_TINT, "border-b border-line/60 px-3 text-left font-normal text-ink-soft")}>
            {t("other")}
          </th>
          {renderCells(`other:${kind}`)}
        </tr>
      )}
      <tr>
        <th scope="row" className={cn(STICKY, "border-t border-b border-t-line-strong border-b-line/60 px-3 text-left font-semibold text-ink")}>
          {t(`${kind}Total`)}
        </th>
        {renderCells(`total:${kind}`, { strong: true, topLine: true })}
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
  handle,
  canEdit,
  onRename,
  onDelete,
}: {
  row: ModelRow;
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
    <th scope="row" className={cn(STICKY_TINT, "group/row border-b border-line/60 px-1 text-left font-normal text-ink")}>
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
  weeks,
  currentCol,
  onAdd,
}: {
  kind: PlanKind;
  weeks: number;
  currentCol: (col: number) => boolean;
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
      <th scope="row" className={cn(STICKY, "border-b border-line/60 px-1 font-normal")}>
        <input
          value={label}
          maxLength={120}
          disabled={busy}
          data-new-row={kind}
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
      {Array.from({ length: weeks + 1 }, (_, col) => (
        <td
          key={col}
          className={cn(
            "border-b border-line/60",
            col === weeks && "border-l border-line",
            currentCol(col) && "bg-ink/4",
          )}
        />
      ))}
    </tr>
  );
}
