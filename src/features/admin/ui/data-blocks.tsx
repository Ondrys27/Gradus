"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MetricUnit } from "@/lib/analytics/metrics";
import { SEGMENT_VALUES } from "@/lib/analytics/metrics";
import { countryName, formatCalendarDate, formatNumber, weekdayShortName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toCsv } from "../access";
import { dropOff } from "../cohorts";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "../format-metric";
import { heat } from "../numbers";
import type { BreakdownData, CohortRow, FieldsData, FunnelStep, HeatmapCell } from "../types";
import { AdminEmpty } from "./blocks";
import { downloadBlob } from "./export-image";
import { ChangeBadge } from "./metric-tile";

const SETTINGS = ADMIN_FORMAT_SETTINGS;

/** Teal of a given strength, from the theme token (no fixed colours). */
function tealAt(strength: number): string {
  return `color-mix(in oklab, var(--color-teal) ${Math.round(strength * 100)}%, transparent)`;
}

// --- Funnel ------------------------------------------------------------------------

/**
 * The activation funnel as bars that narrow step by step, with the share that
 * dropped off between steps and the median time it took.
 */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const t = useTranslations("admin.funnel");
  const tUnits = useTranslations("admin.units");
  if (steps.length === 0 || steps[0].users === 0) return <AdminEmpty />;

  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => (
        <li key={step.key} className="flex flex-col">
          {index > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 py-1 text-xs text-ink-muted">
              <span className="font-medium text-pink tabular-nums">
                {t("dropOff", {
                  value: formatNumber(
                    dropOff(step) / 100,
                    { style: "percent", decimals: 1 },
                    SETTINGS,
                  ),
                })}
              </span>
              {step.medianHoursFromPrevious !== null && (
                <span className="tabular-nums">
                  {t("median", {
                    value: formatMetricValue(step.medianHoursFromPrevious, "hours", tUnits),
                  })}
                </span>
              )}
            </div>
          )}
          <div className="grid grid-cols-[minmax(7rem,11rem)_1fr] items-center gap-3 sm:grid-cols-[13rem_1fr]">
            <span className="text-sm text-ink-soft">{t(`steps.${step.key}`)}</span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex h-9 items-center justify-center">
                <div
                  className="flex h-full min-w-12 items-center justify-center rounded-lg border border-teal/50 px-2 text-xs font-semibold text-ink tabular-nums"
                  style={{
                    width: `${Math.max(2, step.pctOfStart)}%`,
                    background: tealAt(0.15 + 0.5 * (step.pctOfStart / 100)),
                  }}
                >
                  {formatNumber(step.users, {}, SETTINGS)}
                </div>
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-ink-muted tabular-nums">
                {formatMetricValue(step.pctOfStart, "percent", tUnits)}
                {index > 0 && (
                  <ChangeBadge current={step.pctOfStart} previous={step.previousPctOfStart} />
                )}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// --- Cohorts -----------------------------------------------------------------------

/** Week of sign-up × weeks after it; the stronger the teal, the more stayed active. */
export function CohortTable({ cohorts, weeks }: { cohorts: CohortRow[]; weeks: number }) {
  const t = useTranslations("admin.retention");
  if (cohorts.length === 0) return <AdminEmpty />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-separate border-spacing-0.5 text-xs tabular-nums">
        <thead className="text-ink-muted">
          <tr>
            <th scope="col" className="px-2 py-1 text-left font-medium">
              {t("cohort")}
            </th>
            <th scope="col" className="px-2 py-1 text-right font-medium">
              {t("size")}
            </th>
            {Array.from({ length: weeks + 1 }, (_, week) => (
              <th key={week} scope="col" className="px-1 py-1 text-center font-medium">
                {t("weekShort", { n: week })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort) => (
            <tr key={cohort.week}>
              <th
                scope="row"
                className="px-2 py-1.5 text-left font-medium whitespace-nowrap text-ink-soft"
              >
                {formatCalendarDate(cohort.week, SETTINGS)}
              </th>
              <td className="px-2 py-1.5 text-right text-ink-soft">
                {formatNumber(cohort.size, {}, SETTINGS)}
              </td>
              {cohort.cells.map((pct, week) => {
                const strength = pct === null ? 0 : heat(pct, 100);
                return (
                  <td
                    key={week}
                    className={
                      pct === null
                        ? "rounded-md"
                        : strength > 0.6
                          ? "rounded-md px-1 py-1.5 text-center font-semibold text-canvas-deep"
                          : "rounded-md px-1 py-1.5 text-center text-ink"
                    }
                    style={pct === null ? undefined : { background: tealAt(strength) }}
                  >
                    {pct === null
                      ? null
                      : formatNumber(pct / 100, { style: "percent", decimals: 0 }, SETTINGS)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Usage heat map ----------------------------------------------------------------

/** When people work: ISO weekday × hour, teal by the number of actions. */
export function UsageHeatmap({ grid }: { grid: HeatmapCell[][] }) {
  const t = useTranslations("admin.retention");
  const locale = useLocale();
  const max = Math.max(0, ...grid.flat().map((cell) => cell.events));
  if (max === 0) return <AdminEmpty />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-separate border-spacing-0.5 text-[10px] tabular-nums">
        <thead className="text-ink-muted">
          <tr>
            <th scope="col">
              <span className="sr-only">{t("day")}</span>
            </th>
            {Array.from({ length: 24 }, (_, hour) => (
              <th key={hour} scope="col" className="font-normal">
                {hour % 3 === 0 ? formatNumber(hour, {}, SETTINGS) : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, index) => {
            const day = weekdayShortName((index + 1) % 7, locale);
            return (
              <tr key={index}>
                <th scope="row" className="pr-2 text-left text-xs font-medium text-ink-soft">
                  {day}
                </th>
                {row.map((cell) => (
                  <td
                    key={cell.hour}
                    className="h-6 min-w-4 rounded-sm"
                    style={{
                      background: cell.events > 0 ? tealAt(heat(cell.events, max)) : undefined,
                    }}
                    title={t("heatCell", {
                      day,
                      hour: formatNumber(cell.hour, {}, SETTINGS),
                      events: formatNumber(cell.events, {}, SETTINGS),
                      users: formatNumber(cell.users, {}, SETTINGS),
                    })}
                  >
                    <span className="sr-only">
                      {t("heatCell", {
                        day,
                        hour: formatNumber(cell.hour, {}, SETTINGS),
                        events: formatNumber(cell.events, {}, SETTINGS),
                        users: formatNumber(cell.users, {}, SETTINGS),
                      })}
                    </span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
        <span>{t("less")}</span>
        {[0.15, 0.35, 0.55, 0.8, 1].map((strength) => (
          <span
            key={strength}
            aria-hidden
            className="size-3 rounded-sm"
            style={{ background: tealAt(strength) }}
          />
        ))}
        <span>{t("more")}</span>
      </div>
    </div>
  );
}

// --- Breakdowns --------------------------------------------------------------------

const SEGMENT_OF: Record<string, keyof typeof SEGMENT_VALUES> = {
  users_by_plan: "plan",
  users_by_role: "role",
  users_by_device: "device",
  users_by_locale: "locale",
};

/** A small export button for a breakdown or a fields block, keyed by the metric. */
function ExportRowsButton({
  id,
  header,
  rows,
}: {
  id: string;
  header: readonly string[];
  rows: readonly (readonly (string | number | null)[])[];
}) {
  const tChart = useTranslations("admin.chart");
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function exportCsv() {
    setExporting(true);
    setFailed(false);
    try {
      const blob = new Blob([toCsv(header, rows)], { type: "text/csv;charset=utf-8" });
      const { recordExport } = await import("../server/export-actions");
      const { ok } = await recordExport(`table.${id}.csv`);
      if (!ok) throw new Error("Audit refused the export");
      downloadBlob(blob, `${id.replace(/\./g, "-")}.csv`);
    } catch (error) {
      console.error("[admin] export failed", error);
      setFailed(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {failed && <span className="text-xs text-pink">{tChart("exportFailed")}</span>}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={tChart("exportCsv")}
        title={tChart("exportCsv")}
        disabled={exporting}
        onClick={() => void exportCsv()}
      >
        <DownloadIcon aria-hidden />
      </Button>
    </div>
  );
}

/** One metric split into groups, as bars with their share and change. */
export function BreakdownList({ data, max = 12 }: { data: BreakdownData; max?: number }) {
  const t = useTranslations();
  const tUnits = useTranslations("admin.units");
  const locale = useLocale();
  const items = data.items.filter((item) => item.value !== null && item.value > 0).slice(0, max);
  if (items.length === 0) return <AdminEmpty className="py-6" />;
  const total = items.reduce((sum, item) => sum + (item.value ?? 0), 0);
  const top = Math.max(...items.map((item) => item.value ?? 0));

  function label(key: string): string {
    if (key === "none" || key === "null" || key === "") return t("admin.breakdown.none");
    const segment = SEGMENT_OF[data.key];
    if (segment && t.has(`admin.controls.segmentValues.${segment}.${key}`)) {
      return t(`admin.controls.segmentValues.${segment}.${key}`);
    }
    if (data.key === "users_by_country") return countryName(key, locale);
    if (data.key === "users_by_industry" && t.has(`onboarding.industry.industries.${key}.label`)) {
      return t(`onboarding.industry.industries.${key}.label`);
    }
    return key;
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink-soft">{label(item.key)}</span>
              <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                <span className="font-semibold text-ink">
                  {formatMetricValue(item.value, data.unit, tUnits)}
                </span>
                {data.unit !== "ratio" && data.unit !== "percent" && total > 0 && (
                  <span className="text-xs text-ink-muted">
                    {formatNumber(
                      (item.value ?? 0) / total,
                      { style: "percent", decimals: 0 },
                      SETTINGS,
                    )}
                  </span>
                )}
                <ChangeBadge current={item.value} previous={item.previous} />
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-line/40">
              <div
                className="h-full rounded-full bg-violet"
                style={{ width: `${top > 0 ? ((item.value ?? 0) / top) * 100 : 0}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <ExportRowsButton
        id={`breakdown.${data.key}`}
        header={["key", "value"]}
        rows={items.map((item) => [item.key, item.value])}
      />
    </div>
  );
}

// --- Single-row functions ----------------------------------------------------------

export function FieldsGrid({ data }: { data: FieldsData }) {
  const t = useTranslations("admin.fields");
  const tUnits = useTranslations("admin.units");
  if (data.fields.every((field) => !field.value)) return <AdminEmpty className="py-6" />;
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {data.fields.map((field) => (
          <div key={field.name} className="flex min-w-0 flex-col gap-0.5">
            <dt className="truncate text-xs text-ink-muted">{t(field.name)}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-2">
              <span className="stat-number text-lg text-ink">
                {formatMetricValue(field.value, field.unit, tUnits)}
              </span>
              <ChangeBadge current={field.value} previous={field.previous} />
            </dd>
          </div>
        ))}
      </dl>
      <ExportRowsButton
        id={`fields.${data.key}`}
        header={["name", "value"]}
        rows={data.fields.map((field) => [field.name, field.value])}
      />
    </div>
  );
}

// --- Generic rows table ------------------------------------------------------------

export type DataTableColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Renders the cell; the plain value also becomes the CSV cell unless `csv` is given. */
  render: (row: T) => string;
  /** The raw value for the CSV export, when it should differ from the rendered text. */
  csv?: (row: T) => string | number | null;
};

/**
 * Any table of rows the registry returns as-is (a top-10 list, a cost
 * breakdown, a cron job's last run…). One export button, written to the
 * audit like a chart's.
 */
export function DataTable<T>({
  id,
  columns,
  rows,
}: {
  id: string;
  columns: DataTableColumn<T>[];
  rows: T[];
}) {
  const tChart = useTranslations("admin.chart");
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);
  if (rows.length === 0) return <AdminEmpty className="py-6" />;

  async function exportCsv() {
    setExporting(true);
    setFailed(false);
    try {
      const header = columns.map((column) => column.key);
      const body = rows.map((row) =>
        columns.map((column) => (column.csv ? column.csv(row) : column.render(row))),
      );
      const blob = new Blob([toCsv(header, body)], { type: "text/csv;charset=utf-8" });
      // Imported lazily: a server action, pulled in only when the button is used.
      const { recordExport } = await import("../server/export-actions");
      const { ok } = await recordExport(`table.${id}.csv`);
      if (!ok) throw new Error("Audit refused the export");
      downloadBlob(blob, `${id.replace(/\./g, "-")}.csv`);
    } catch (error) {
      console.error("[admin] table export failed", error);
      setFailed(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={tChart("exportCsv")}
          title={tChart("exportCsv")}
          disabled={exporting}
          onClick={() => void exportCsv()}
        >
          <DownloadIcon aria-hidden />
        </Button>
      </div>
      {failed && <p className="text-xs text-pink">{tChart("exportFailed")}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="text-xs text-ink-soft">
            <tr className="border-b border-line">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "px-3 py-2 font-medium whitespace-nowrap",
                    column.align === "right" && "text-right",
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-line last:border-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-3 py-2 tabular-nums whitespace-nowrap",
                      column.align === "right" && "text-right",
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A cell of a registry unit, formatted the same way a tile would. */
export function dataCell(value: unknown, unit: MetricUnit, tUnits: ReturnType<typeof useTranslations>) {
  return formatMetricValue(typeof value === "number" ? value : Number(value ?? NaN), unit, tUnits);
}
