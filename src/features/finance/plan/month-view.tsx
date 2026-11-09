"use client";

import { useMemo, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { arrayMove } from "@dnd-kit/sortable";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyPlusIcon,
  DownloadIcon,
  EllipsisIcon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { canDo } from "@/features/account/workspace";
import { useWorkspace } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import { formatDayMonth, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { Segmented } from "../segmented";
import { TransactionFormDialog, type TransactionDefaults } from "../transaction-form-dialog";
import { CATEGORIES } from "../types";
import { normalizeLabel, transactionsOfCell } from "./assign";
import { uniqueLabel, type PipelineSuggestion } from "./carry-over";
import { planGrid, gridToCsv, type PlanLayoutTexts } from "./layout";
import { CellTransactionsDialog, CreateMonthDialog, ImportMonthDialog } from "./month-dialogs";
import { buildMonthModel, dayForNewTransaction, type ModelRow } from "./month-model";
import { PlanGrid } from "./plan-grid";
import {
  planErrorKey,
  useAddPlanRow,
  useDeletePlanRow,
  useMovePlanRow,
  usePlanActuals,
  usePlanDeals,
  usePlanMonth,
  useRenamePlanRow,
  useSavePlanCell,
  useUpdatePlanMonth,
  type PlanErrorKey,
} from "./queries";
import {
  computeSheet,
  kindsOf,
  OTHER_ROW,
  planValues,
  PLAN_VIEWS,
  rowsOfKind,
  type PlanKind,
  type PlanView,
} from "./sheet";
import { SummaryPanel } from "./summary-panel";
import { monthNumber, monthWeeks, monthYear, shiftMonth, weekCount, type PlanMonthKey } from "./weeks";
import { gridToXlsx } from "./xlsx";

/** "Listopad 2026", "listopad", "z listopadu": the month names live in the translations. */
export function useMonthNames() {
  const t = useTranslations("finance.plan.months");
  return {
    title: (month: PlanMonthKey) => t("title", { name: t(`title${monthNumber(month)}`), year: String(monthYear(month)) }),
    name: (month: PlanMonthKey) => t(`name${monthNumber(month)}`),
    from: (month: PlanMonthKey) => t(`from${monthNumber(month)}`),
  };
}

type Props = {
  month: PlanMonthKey;
  onMonthChange: (month: PlanMonthKey) => void;
  /** Category key → its names in every language (from the server, so no dictionary ships to the browser). */
  categoryNames: Record<string, string[]>;
};

type CellTarget = { rowId: string; kind: PlanKind; label: string; week: number };

export function MonthView({ month, onMonthChange, categoryNames }: Props) {
  const t = useTranslations("finance.plan");
  const tGrid = useTranslations("finance.plan.grid");
  const tSummary = useTranslations("finance.plan.summary");
  const settings = useFormatSettings();
  const names = useMonthNames();
  const today = todayIsoDate(settings);
  const workspace = useWorkspace();
  const canWrite = canDo(workspace, "finance", "write");
  const [view, setView] = useState<PlanView>("plan");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [error, setError] = useState<PlanErrorKey | null>(null);
  const [creating, setCreating] = useState<"empty" | "previous" | null>(null);
  const [carrying, setCarrying] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<ModelRow | null>(null);
  const [cellTarget, setCellTarget] = useState<CellTarget | null>(null);
  const [newTransaction, setNewTransaction] = useState<TransactionDefaults | null>(null);

  const previousMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  const plan = usePlanMonth(month);
  const previous = usePlanMonth(previousMonth);
  const next = usePlanMonth(nextMonth);
  const exists = Boolean(plan.data?.month);
  const actuals = usePlanActuals(month, exists);
  const deals = usePlanDeals(month, exists && canWrite);
  const closed = plan.data?.month?.closed ?? false;
  const canEdit = canWrite && !closed;

  const saveCell = useSavePlanCell(month);
  const updateMonth = useUpdatePlanMonth(month);
  const addRow = useAddPlanRow(month);
  const renameRow = useRenamePlanRow(month);
  const moveRow = useMovePlanRow(month);
  const deleteRow = useDeletePlanRow(month);

  const model = useMemo(
    () =>
      plan.data
        ? buildMonthModel({
            monthKey: month,
            plan: plan.data,
            transactions: actuals.data ?? null,
            deals: deals.data ?? [],
            view,
            today,
            hideEmpty,
            categoryNames,
          })
        : null,
    [plan.data, actuals.data, deals.data, view, today, hideEmpty, month, categoryNames],
  );

  /** The planned closing capital of a loaded month (what the next one starts with). */
  const closingOf = (data: typeof previous.data, key: PlanMonthKey) => {
    if (!data?.month) return 0;
    const weeks = weekCount(key);
    return computeSheet({
      weeks,
      opening: data.month.opening_capital,
      kinds: kindsOf(data.rows),
      values: planValues(data.rows, data.cells, weeks),
    }).summary.closing;
  };

  const fail = (caught: unknown) => setError(planErrorKey(caught));
  const currency = plan.data?.month?.currency ?? settings.currency;

  function changeView(value: PlanView) {
    setView(value);
    track("finance_plan_view_changed", { view: value });
  }

  async function onAddRow(kind: PlanKind, label: string) {
    setError(null);
    const taken = rowsOfKind(plan.data?.rows ?? [], kind).map((row) => normalizeLabel(row.label));
    if (taken.includes(normalizeLabel(label))) {
      setError("labelTaken");
      return null;
    }
    try {
      return await addRow.mutateAsync({ kind, label, from: "typed" });
    } catch (caught) {
      fail(caught);
      return null;
    }
  }

  async function onRenameRow(id: string, label: string) {
    setError(null);
    const row = plan.data?.rows.find((item) => item.id === id);
    const taken = rowsOfKind(plan.data?.rows ?? [], row?.kind ?? "income")
      .filter((item) => item.id !== id)
      .map((item) => normalizeLabel(item.label));
    if (taken.includes(normalizeLabel(label))) {
      setError("labelTaken");
      return false;
    }
    try {
      await renameRow.mutateAsync({ id, label });
      return true;
    } catch (caught) {
      fail(caught);
      return false;
    }
  }

  function onMoveRow(kind: PlanKind, activeId: string, overId: string) {
    const ordered = rowsOfKind(plan.data?.rows ?? [], kind);
    const from = ordered.findIndex((row) => row.id === activeId);
    const to = ordered.findIndex((row) => row.id === overId);
    if (from < 0 || to < 0) return;
    const order = arrayMove(ordered, from, to)
      .map((row, position) => ({ id: row.id, position, before: row.position }))
      .filter((item) => item.position !== item.before)
      .map(({ id, position }) => ({ id, position }));
    if (order.length) moveRow.mutate(order, { onError: fail });
  }

  function onAccept(suggestion: PipelineSuggestion) {
    const taken = rowsOfKind(plan.data?.rows ?? [], "income").map((row) => row.label);
    addRow.mutate(
      {
        kind: "income",
        label: uniqueLabel(suggestion.label, taken),
        from: "pipeline",
        source: "deal",
        sourceId: suggestion.dealId,
        cells: [{ week: suggestion.week, planned: suggestion.amount }],
      },
      { onError: fail },
    );
  }

  function openAddTransaction(target: CellTarget) {
    const week = monthWeeks(month)[target.week - 1];
    const isOther = target.rowId === OTHER_ROW.income || target.rowId === OTHER_ROW.expense;
    const category =
      CATEGORIES[target.kind].find((key) =>
        [key, ...(categoryNames[key] ?? [])].some((name) => normalizeLabel(name) === normalizeLabel(target.label)),
      ) ?? null;
    setNewTransaction({
      type: target.kind,
      occurred_on: dayForNewTransaction(week, today),
      description: isOther || category ? "" : target.label,
      category,
    });
    setCellTarget(null);
  }

  function layoutTexts(): PlanLayoutTexts {
    return {
      title: names.title(month),
      weeks: monthWeeks(month).map(
        (week) =>
          `${tGrid("week", { week: week.week })} (${formatDayMonth(week.start, settings)} – ${formatDayMonth(week.end, settings)})`,
      ),
      total: tGrid("total"),
      opening: tGrid("opening"),
      income: tGrid("income").toLocaleUpperCase(),
      incomeTotal: tGrid("incomeTotal"),
      expense: tGrid("expense").toLocaleUpperCase(),
      expenseTotal: tGrid("expenseTotal"),
      capital: tGrid("capital").toLocaleUpperCase(),
      balance: tGrid("balance"),
      closing: tGrid("closing"),
      summary: tSummary("title"),
      summaryOpening: tSummary("opening"),
      summaryIncome: tSummary("income"),
      summaryExpense: tSummary("expense"),
      summaryBalance: tSummary("balance"),
      summaryClosing: tSummary("closing"),
      summaryLowest: tSummary("lowest"),
      summaryLowestWeek: tSummary("lowestWhen"),
      legend: t("export.legend", { currency }),
    };
  }

  function download(format: "csv" | "xlsx") {
    if (!plan.data?.month) return;
    const weeks = weekCount(month);
    const grid = planGrid({
      texts: layoutTexts(),
      rows: plan.data.rows,
      values: planValues(plan.data.rows, plan.data.cells, weeks),
      opening: plan.data.month.opening_capital,
    });
    const blob =
      format === "csv"
        ? new Blob([gridToCsv(grid)], { type: "text/csv;charset=utf-8" })
        : new Blob([gridToXlsx(grid, names.title(month)) as BlobPart], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${t("export.fileName", { month })}.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    track("finance_plan_exported", { format });
  }

  const cellTransactions =
    cellTarget && model ? transactionsOfCell(model.assignments, cellTarget.rowId, cellTarget.week) : [];
  const itemClass =
    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[15px] text-ink-soft outline-none select-none data-highlighted:bg-surface-hover data-highlighted:text-ink mouse:min-h-9 [&_svg]:size-4";
  const previousTitle = names.title(previousMonth);

  return (
    <div className="flex flex-col gap-4" data-testid="finance-month">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("previousMonth", { month: previousTitle })}
            onClick={() => onMonthChange(previousMonth)}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <h2 className="min-w-40 text-center text-lg font-semibold text-ink" aria-live="polite">
            {names.title(month)}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("nextMonth", { month: names.title(nextMonth) })}
            onClick={() => onMonthChange(nextMonth)}
          >
            <ChevronRightIcon aria-hidden />
          </Button>
          {exists && <span className="text-xs text-ink-muted">{currency}</span>}
          {closed && (
            <span className="ml-2 flex items-center gap-1 text-xs text-ink-muted">
              <LockIcon aria-hidden className="size-3.5" />
              {t("closedBadge")}
            </span>
          )}
        </div>
        {exists && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Segmented
              label={t("views.label")}
              value={view}
              options={PLAN_VIEWS.map((value) => ({ value, label: t(`views.${value}`) }))}
              onChange={changeView}
            />
          </div>
        )}
      </div>

      {exists && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink-soft">
            <Switch checked={hideEmpty} onCheckedChange={setHideEmpty} />
            {t("hideEmpty")}
            {hideEmpty && model && model.hiddenRows > 0 && (
              <span className="text-xs text-ink-muted">({t("hiddenRows", { count: model.hiddenRows })})</span>
            )}
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {canWrite && next.data && !next.data.month && (
              <Button variant="outline" onClick={() => setCarrying(true)}>
                <CopyPlusIcon aria-hidden data-icon="inline-start" />
                {t("carry", { next: names.name(nextMonth), from: names.from(month) })}
              </Button>
            )}
            <Menu.Root>
              <Menu.Trigger
                render={<Button variant="outline" />}
                aria-label={t("export.label")}
              >
                <DownloadIcon aria-hidden data-icon="inline-start" />
                {t("export.label")}
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner sideOffset={4} align="end" className="z-popover">
                  <Menu.Popup className="min-w-44 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
                    <Menu.Item className={itemClass} onClick={() => download("xlsx")}>
                      {t("export.xlsx")}
                    </Menu.Item>
                    <Menu.Item className={itemClass} onClick={() => download("csv")}>
                      {t("export.csv")}
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
            {canWrite && (
              <Menu.Root>
                <Menu.Trigger
                  aria-label={t("more")}
                  className="grid size-11 cursor-pointer place-items-center rounded-xl border border-line text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:size-9"
                >
                  <EllipsisIcon aria-hidden className="size-4" />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner sideOffset={4} align="end" className="z-popover">
                    <Menu.Popup className="min-w-52 rounded-xl border border-line-strong bg-surface p-1.5 shadow-popover outline-none">
                      {!closed && (
                        <Menu.Item className={itemClass} onClick={() => setImporting(true)}>
                          <UploadIcon aria-hidden />
                          {t("import.menu")}
                        </Menu.Item>
                      )}
                      <Menu.Item
                        className={itemClass}
                        onClick={() => updateMonth.mutate({ closed: !closed }, { onError: fail })}
                      >
                        {closed ? <LockOpenIcon aria-hidden /> : <LockIcon aria-hidden />}
                        {closed ? t("reopen") : t("close")}
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            )}
          </div>
        </div>
      )}

      {error && <FormAlert>{t(`errors.${error}`)}</FormAlert>}

      {plan.isError ? (
        <FormAlert>{t("loadFailed")}</FormAlert>
      ) : !plan.data ? (
        <Skeleton className="h-96 rounded-card" />
      ) : !exists ? (
        <EmptyState
          title={t("empty.title", { month: names.title(month) })}
          description={t("empty.description")}
          action={
            canWrite && (
              <div className="flex flex-wrap justify-center gap-2">
                {previous.data?.month && (
                  <Button onClick={() => setCreating("previous")}>
                    <CopyPlusIcon aria-hidden data-icon="inline-start" />
                    {t("carry", { next: names.name(month), from: names.from(previousMonth) })}
                  </Button>
                )}
                <Button
                  variant={previous.data?.month ? "outline" : "default"}
                  onClick={() => setCreating("empty")}
                >
                  <PlusIcon aria-hidden data-icon="inline-start" />
                  {t("empty.create", { month: names.name(month) })}
                </Button>
                <Button variant="ghost" onClick={() => setImporting(true)}>
                  <UploadIcon aria-hidden data-icon="inline-start" />
                  {t("import.menu")}
                </Button>
              </div>
            )
          }
        />
      ) : (
        model && (
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start">
            <div className="lg:order-2">
              <SummaryPanel
                summary={(view === "actual" && model.actualSheet ? model.actualSheet : model.planSheet).summary}
                weeks={model.weeks}
                currency={currency}
                reserve={plan.data.month?.reserve ?? null}
                canEdit={canEdit}
                onSaveReserve={(reserve) => updateMonth.mutate({ reserve }, { onError: fail })}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2 lg:order-1">
              <PlanGrid
                model={model}
                view={view}
                opening={plan.data.month?.opening_capital ?? 0}
                canEdit={canEdit}
                onSaveCell={(change) => {
                  setError(null);
                  saveCell.mutate(change, { onError: fail });
                }}
                onSaveOpening={(value) => {
                  setError(null);
                  updateMonth.mutate({ opening_capital: value }, { onError: fail });
                }}
                onAddRow={onAddRow}
                onRenameRow={onRenameRow}
                onDeleteRow={(row) => {
                  if (row.plan.some((value) => value !== 0)) setDeleting(row);
                  else deleteRow.mutate({ id: row.id, kind: row.kind, hadNumbers: false }, { onError: fail });
                }}
                onMoveRow={onMoveRow}
                onOpenCell={(rowId, kind, label, week) => setCellTarget({ rowId, kind, label, week })}
                onAcceptSuggestion={onAccept}
              />
              <p className={cn("text-xs text-ink-muted")}>{t("help")}</p>
            </div>
          </div>
        )
      )}

      <CreateMonthDialog
        open={creating !== null}
        onOpenChange={(open) => !open && setCreating(null)}
        month={month}
        title={names.title(month)}
        previous={
          creating === "previous" && previous.data?.month
            ? { plan: previous.data, closing: closingOf(previous.data, previousMonth), title: previousTitle }
            : null
        }
        currency={settings.currency}
        onCreated={() => setError(null)}
      />
      <CreateMonthDialog
        open={carrying}
        onOpenChange={setCarrying}
        month={nextMonth}
        title={names.title(nextMonth)}
        previous={plan.data?.month ? { plan: plan.data, closing: closingOf(plan.data, month), title: names.title(month) } : null}
        currency={currency}
        onCreated={() => onMonthChange(nextMonth)}
      />
      <ImportMonthDialog
        open={importing}
        onOpenChange={setImporting}
        month={month}
        title={names.title(month)}
        exists={exists}
        opening={plan.data?.month?.opening_capital ?? 0}
        reserve={plan.data?.month?.reserve ?? null}
        currency={currency}
        onImported={() => setError(null)}
      />
      <CellTransactionsDialog
        open={cellTarget !== null}
        onOpenChange={(open) => !open && setCellTarget(null)}
        title={
          cellTarget
            ? t("cell.title", { row: cellTarget.label, week: cellTarget.week })
            : ""
        }
        transactions={cellTransactions}
        currency={currency}
        kind={cellTarget?.kind ?? "income"}
        canAdd={canWrite}
        onAdd={() => cellTarget && openAddTransaction(cellTarget)}
      />
      <TransactionFormDialog
        open={newTransaction !== null}
        onOpenChange={(open) => !open && setNewTransaction(null)}
        transaction={null}
        defaults={newTransaction ?? undefined}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deleteRow.title")}
        description={t("deleteRow.description", { name: deleting?.label ?? "" })}
        confirmLabel={t("deleteRow.confirm")}
        cancelLabel={t("deleteRow.cancel")}
        closeLabel={t("deleteRow.cancel")}
        onConfirm={() => {
          if (deleting) deleteRow.mutate({ id: deleting.id, kind: deleting.kind, hadNumbers: true }, { onError: fail });
          setDeleting(null);
        }}
      />
    </div>
  );
}
