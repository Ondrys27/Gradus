"use client";

import { useState, type FormEvent } from "react";
import { PlusIcon, UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { track } from "@/lib/analytics/client";
import { formatCalendarDate, formatCurrency } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { categoryIcon } from "../types";
import { decimalMarkOf, parseAmountInput } from "./amount-input";
import type { PlanTransaction } from "./assign";
import { buildNewMonth, CARRY_MODES, type CarryMode } from "./carry-over";
import { importPlanCsv, IMPORT_MAX_BYTES, type ImportedPlan, type ImportProblem } from "./layout";
import type { LoadedPlan } from "./load";
import { fetchCarrySources, planErrorKey, useWritePlanMonth, type PlanErrorKey } from "./queries";
import type { PlanKind } from "./sheet";
import { weekCount, type PlanMonthKey } from "./weeks";

// -----------------------------------------------------------------------------
// A new month (empty, or from the previous one)
// -----------------------------------------------------------------------------

type CreateProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: PlanMonthKey;
  /** "Prosinec 2026" */
  title: string;
  /** The month before, when it has a plan: rows to copy and its closing capital. */
  previous: { plan: LoadedPlan; closing: number; title: string } | null;
  currency: string;
  onCreated: () => void;
};

export function CreateMonthDialog(props: CreateProps) {
  const t = useTranslations("finance.plan.create");
  return (
    <ResponsiveDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.previous ? t("fromTitle", { month: props.title }) : t("title", { month: props.title })}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,480px)]"
    >
      {props.open && <CreateForm {...props} />}
    </ResponsiveDialog>
  );
}

function CreateForm({ month, previous, currency: fallbackCurrency, onCreated, onOpenChange }: CreateProps) {
  const t = useTranslations("finance.plan.create");
  // Carried from a month, the new one keeps its currency: the copied numbers and
  // the opening capital are in it, and amounts never convert.
  const currency = previous?.plan.month?.currency ?? fallbackCurrency;
  const tErrors = useTranslations("finance.plan.errors");
  const settings = useFormatSettings();
  const decimal = decimalMarkOf(settings.numberLocale);
  const space = useWorkspaceId();
  const write = useWritePlanMonth();
  const [mode, setMode] = useState<CarryMode>("labels");
  const [opening, setOpening] = useState(() =>
    previous ? String(previous.closing).replace(".", decimal) : "",
  );
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<PlanErrorKey | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseAmountInput(opening, decimal);
    if (!parsed.ok) {
      setInvalid(true);
      return;
    }
    setError(null);
    try {
      const sources = await fetchCarrySources(space, month);
      const rows = buildNewMonth({
        month,
        currency,
        previous: previous
          ? { rows: previous.plan.rows, cells: previous.plan.cells, weeks: weekCount(previous.plan.month!.month) }
          : null,
        mode,
        recurring: sources.recurring,
        invoices: sources.invoices,
      });
      await write.mutateAsync({
        month,
        opening: parsed.value ?? 0,
        reserve: previous?.plan.month?.reserve ?? null,
        currency,
        rows,
      });
      track("finance_plan_month_created", {
        from: previous ? "previous" : "empty",
        ...(previous ? { mode } : {}),
        rows: rows.length,
        recurring: rows.filter((row) => row.source === "recurring").length,
        invoices: rows.filter((row) => row.source === "invoice" || row.source === "contact").length,
      });
      onCreated();
      onOpenChange(false);
    } catch (caught) {
      setError(planErrorKey(caught));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {previous && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink">{t("copyLegend", { month: previous.title })}</legend>
          {CARRY_MODES.map((value) => (
            <label
              key={value}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2",
                mode === value ? "border-violet bg-violet/10" : "border-line",
              )}
            >
              <input
                type="radio"
                name="carry-mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className="mt-1 accent-violet"
              />
              <span className="flex flex-col">
                <span className="text-sm text-ink">{t(`mode.${value}`)}</span>
                <span className="text-xs text-ink-muted">{t(`modeHint.${value}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
        {t("opening", { currency })}
        <input
          value={opening}
          inputMode="decimal"
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            setOpening(event.target.value);
            setInvalid(false);
          }}
          className={cn(
            "h-11 rounded-xl border bg-canvas-deep px-3 text-right text-violet tabular-nums outline-none focus:border-violet",
            invalid ? "border-pink" : "border-line",
          )}
        />
        <span className="text-xs font-normal text-ink-muted">
          {previous ? t("openingFromPrevious", { month: previous.title }) : t("openingHint")}
        </span>
      </label>
      <p className="text-xs text-ink-muted">{t("autoFill")}</p>
      {error && <FormAlert>{tErrors(error)}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={write.isPending}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}

// -----------------------------------------------------------------------------
// The transactions behind one cell of the actuals
// -----------------------------------------------------------------------------

type CellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  transactions: PlanTransaction[];
  currency: string;
  kind: PlanKind;
  canAdd: boolean;
  onAdd: () => void;
};

export function CellTransactionsDialog({ open, onOpenChange, title, transactions, currency, canAdd, onAdd }: CellProps) {
  const t = useTranslations("finance.plan.cell");
  const tCategories = useTranslations("finance.categories");
  const settings = useFormatSettings();
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,480px)]"
    >
      <div className="flex flex-col gap-4">
        {transactions.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/60" data-testid="plan-cell-transactions">
            {transactions.map((transaction) => {
              const Icon = categoryIcon(transaction.category);
              const known = transaction.category && tCategories.has(transaction.category);
              return (
                <li key={transaction.id} className="flex items-center gap-3 py-2">
                  <Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-ink">
                      {transaction.description ||
                        (known ? tCategories(transaction.category as string) : t("noDescription"))}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {formatCalendarDate(transaction.occurred_on, settings)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "text-sm tabular-nums",
                      transaction.type === "income" ? "text-teal" : "text-pink",
                    )}
                  >
                    {formatCurrency(
                      transaction.amount,
                      currency,
                      settings,
                      Number.isInteger(transaction.amount) ? 0 : 2,
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {canAdd && (
          <Button type="button" variant="outline" onClick={onAdd} className="self-start">
            <PlusIcon aria-hidden data-icon="inline-start" />
            {t("add")}
          </Button>
        )}
      </div>
    </ResponsiveDialog>
  );
}

// -----------------------------------------------------------------------------
// Import from a CSV in the same layout
// -----------------------------------------------------------------------------

type ImportProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: PlanMonthKey;
  title: string;
  /** The month already has a plan: importing replaces it. */
  exists: boolean;
  opening: number;
  reserve: number | null;
  currency: string;
  onImported: () => void;
};

export function ImportMonthDialog(props: ImportProps) {
  const t = useTranslations("finance.plan.import");
  return (
    <ResponsiveDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t("title", { month: props.title })}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,520px)]"
    >
      {props.open && <ImportForm {...props} />}
    </ResponsiveDialog>
  );
}

function ImportForm({ month, exists, opening, reserve, currency, onImported, onOpenChange }: ImportProps) {
  const t = useTranslations("finance.plan.import");
  const tErrors = useTranslations("finance.plan.errors");
  const settings = useFormatSettings();
  const write = useWritePlanMonth();
  const [plan, setPlan] = useState<ImportedPlan | null>(null);
  const [problem, setProblem] = useState<ImportProblem | null>(null);
  const [error, setError] = useState<PlanErrorKey | null>(null);

  async function read(file: File | undefined) {
    setPlan(null);
    setProblem(null);
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      setProblem("tooLarge");
      return;
    }
    const result = importPlanCsv(await file.text(), {
      weeks: weekCount(month),
      decimal: decimalMarkOf(settings.numberLocale),
    });
    if (result.ok) setPlan(result.plan);
    else setProblem(result.problem);
  }

  async function submit() {
    if (!plan) return;
    setError(null);
    try {
      await write.mutateAsync({
        month,
        opening: plan.opening ?? opening,
        reserve,
        currency,
        rows: plan.rows,
        replace: true,
      });
      track("finance_plan_imported", { rows: plan.rows.length, replaced: exists });
      if (!exists) {
        track("finance_plan_month_created", {
          from: "import",
          rows: plan.rows.length,
          recurring: 0,
          invoices: 0,
        });
      }
      onImported();
      onOpenChange(false);
    } catch (caught) {
      setError(planErrorKey(caught));
    }
  }

  const count = (kind: PlanKind) => plan?.rows.filter((row) => row.kind === kind).length ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">{t("description")}</p>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 self-start rounded-xl border border-line px-4 text-sm text-ink hover:bg-surface-hover focus-within:ring-3 focus-within:ring-violet/40">
        <UploadIcon aria-hidden className="size-4" />
        {t("choose")}
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          onChange={(event) => void read(event.target.files?.[0])}
        />
      </label>
      {problem && <FormAlert>{t(`problems.${problem}`)}</FormAlert>}
      {plan && (
        <div className="rounded-xl border border-line px-3 py-2 text-sm text-ink" data-testid="plan-import-preview">
          {t("preview", {
            income: count("income"),
            expense: count("expense"),
            opening:
              plan.opening === null
                ? t("noOpening")
                : formatCurrency(plan.opening, currency, settings, Number.isInteger(plan.opening) ? 0 : 2),
          })}
          {plan.weeksInFile > weekCount(month) && (
            <p className="mt-1 text-xs text-ink-muted">{t("foldedWeeks", { weeks: weekCount(month) })}</p>
          )}
        </div>
      )}
      {exists && plan && <p className="text-sm text-pink">{t("replaceWarning")}</p>}
      {error && <FormAlert>{tErrors(error)}</FormAlert>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Button>
        <Button type="button" disabled={!plan || write.isPending} onClick={() => void submit()}>
          {exists ? t("replace") : t("submit")}
        </Button>
      </div>
    </div>
  );
}
