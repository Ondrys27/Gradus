"use client";

import { useMemo, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { FlaskConicalIcon, InboxIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toneFill, type Tone } from "@/components/ui/tone";
import type { WidgetSize } from "@/features/widgets/grid";
import {
  Actions,
  Bar,
  Columns,
  Delta,
  DetailHeading,
  Empty,
  Figure,
  Hero,
  Row,
  RowList,
  Sparkline,
  Stack,
  Sub,
  type WidgetDetailProps,
  type WidgetViewProps,
} from "@/features/widgets/kit";
import { formatDateTime, formatDayMonth, formatNumber, formatPrice, type IsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_FORMAT_SETTINGS, formatChange, formatMetricValue } from "../format-metric";
import { changeTone, percentChange } from "../numbers";
import type { ChartData } from "../types";
import { useBreakdownLabel } from "../ui/data-blocks";
import { adminWidgetMeta } from "./catalog";
import type { AdminWidgetData, WidgetFigure, WidgetRow, WidgetStatus } from "./data";

// The full chart (zoom, export) only in a detail.
const AdminChart = dynamic(() => import("../ui/admin-chart").then((module) => module.AdminChart), {
  ssr: false,
});

/**
 * How every widget of the overview draws its numbers (29.3): the anatomy of
 * the app's widgets (kit.tsx) with more data per card, because this is a
 * tool for work. Every size is its own composition, never a smaller copy of
 * another:
 *
 * - S: the one number and its state (nothing else to read).
 * - M: the number with its change against the period before, and under it a
 *   trend (the days of the period as a line or columns), a gauge, the state
 *   dots, or the next figures.
 * - L: the number, a ribbon of the other figures, then a chart or a ranked
 *   list, and an action.
 * - XL: the figures in a row, the chart over the whole period beside the
 *   list, and the actions.
 *
 * Colour is a state, never decoration: pink only where something needs a
 * hand (new errors, failed payments, the AI cap), gold where something
 * waits, green only for a calm zero of a problem count. Everything else is
 * ink. The data comes plain from the route (data.ts); text and numbers are
 * formatted only through format.ts and the administration's units.
 */

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The root translator with a dynamic key (labels come from the server as keys). */
export function useRootT(): Translate {
  const t = useTranslations();
  return (key, values) => (t as unknown as Translate)(key, values);
}

export function useFigureText() {
  const tUnits = useTranslations("admin.units");
  return (value: number | null | undefined, unit: WidgetFigure["unit"] | undefined, currency?: string) => {
    if (value === null || value === undefined) return tUnits("none");
    if (unit === "money") {
      return currency ? formatPrice(value, currency, ADMIN_FORMAT_SETTINGS) : tUnits("none");
    }
    return formatMetricValue(value, unit ?? "count", tUnits);
  };
}

export const STATUS_TONE: Record<WidgetStatus, Tone> = { good: "green", warn: "gold", bad: "pink" };

const STATUS_TEXT: Record<WidgetStatus, string> = {
  good: "text-green",
  warn: "text-gold",
  bad: "text-pink",
};

/** "Test data": Stripe's test mode, the payments of internal accounts. Small, beside the line. */
export function TestDataBadge({ className }: { className?: string }) {
  const t = useTranslations("admin.widgets.board");
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-1.5 py-px text-[10px] font-medium text-gold",
        className,
      )}
      data-testid="widget-test-data"
    >
      <FlaskConicalIcon aria-hidden className="size-2.5" />
      {t("testData")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** The change against the period before as a Delta chip; nothing without a comparison. */
function FigureDelta({ figure }: { figure: WidgetFigure }) {
  const t = useTranslations("admin.tile");
  if (figure.previous === undefined) return null;
  const change = percentChange(figure.value, figure.previous);
  if (change === null) return null;
  const tone = changeTone(change, figure.lowerIsBetter);
  const direction = tone === "flat" ? "same" : change > 0 ? "up" : "down";
  return (
    <span title={t("vsPrevious")}>
      <Delta direction={direction} upIsGood={!figure.lowerIsBetter}>
        {formatChange(change)}
      </Delta>
    </span>
  );
}

/**
 * The hero of a widget: the number in its state colour, the change beside
 * it, the line under it. `size` md beside a chart or a list.
 */
function MainFigure({
  figure,
  size = "lg",
  trail,
  sub,
}: {
  figure: WidgetFigure;
  size?: "lg" | "md";
  /** After the change: the test-data badge. */
  trail?: ReactNode;
  /** Instead of the figure's own label. */
  sub?: ReactNode;
}) {
  const t = useRootT();
  const text = useFigureText();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-widget-figure={figure.key}>
        <Hero size={size} status={figure.status} className={size === "md" ? "@max-md:text-2xl @max-md:leading-none" : undefined}>
          {text(figure.value, figure.unit, figure.currency)}
        </Hero>
        <FigureDelta figure={figure} />
        {trail}
      </div>
      <Sub className={size === "md" ? "text-xs @md:text-sm" : undefined}>{sub ?? t(figure.label, figure.labelValues)}</Sub>
    </div>
  );
}

/** One small figure of a ribbon: its name over its value. */
function MiniFigure({ figure, className }: { figure: WidgetFigure; className?: string }) {
  const t = useRootT();
  const text = useFigureText();
  return (
    <div className={cn("flex min-w-0 flex-col gap-px", className)} data-widget-figure={figure.key}>
      <span className="truncate text-[10px] leading-4 font-medium tracking-wide text-ink-muted uppercase">
        {t(figure.label, figure.labelValues)}
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span
          className={cn(
            "truncate text-[15px] leading-5 font-semibold text-ink tabular-nums",
            figure.status && figure.status !== "good" && STATUS_TEXT[figure.status],
          )}
        >
          {text(figure.value, figure.unit, figure.currency)}
        </span>
        <FigureChange figure={figure} />
      </span>
    </div>
  );
}

/** A change as a tiny signed percentage (a ribbon has no room for a chip). */
function FigureChange({ figure }: { figure: WidgetFigure }) {
  const t = useTranslations("admin.tile");
  if (figure.previous === undefined) return null;
  const change = percentChange(figure.value, figure.previous);
  if (change === null) return null;
  const tone = changeTone(change, figure.lowerIsBetter);
  return (
    <span
      className={cn(
        "shrink-0 text-[11px] font-medium tabular-nums",
        tone === "up" && "text-green",
        tone === "down" && "text-pink",
        tone === "flat" && "text-ink-muted",
      )}
      title={t("vsPrevious")}
    >
      {formatChange(change)}
    </span>
  );
}

/**
 * The other figures of a widget in one row, separated by hairlines; on a
 * narrow widget (a phone) one inline line instead, so nothing is cut off.
 */
function Ribbon({ figures, max = 3, className }: { figures: WidgetFigure[]; max?: number; className?: string }) {
  const t = useRootT();
  const text = useFigureText();
  const shown = figures.slice(0, max);
  if (shown.length === 0) return null;
  return (
    <>
      <div
        className={cn("hidden gap-x-3 divide-x divide-line @md:grid", className)}
        style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}
      >
        {shown.map((figure, index) => (
          <MiniFigure key={figure.key} figure={figure} className={index > 0 ? "pl-3" : undefined} />
        ))}
      </div>
      <p className={cn("flex min-w-0 gap-x-3 overflow-hidden text-xs whitespace-nowrap text-ink-soft @md:hidden", className)}>
        {shown.slice(0, 2).map((figure) => (
          <span key={figure.key} className="flex min-w-0 items-baseline gap-1">
            <span className="truncate">{t(figure.label, figure.labelValues)}</span>
            <span
              className={cn(
                "shrink-0 font-semibold text-ink tabular-nums",
                figure.status && figure.status !== "good" && STATUS_TEXT[figure.status],
              )}
            >
              {text(figure.value, figure.unit, figure.currency)}
            </span>
          </span>
        ))}
      </p>
    </>
  );
}

/** The name of a row, from its text, its key or its breakdown item. */
function useRowName() {
  const t = useRootT();
  const itemLabel = useBreakdownLabel();
  return (row: WidgetRow) =>
    row.text ?? (row.label ? t(row.label, row.labelValues) : row.item ? itemLabel(row.item.metric, row.item.key) : row.id);
}

/** One line of a list: its name, a second line, its value or moment, a state dot or a bar. */
export function WidgetRowItem({
  row,
  compact = false,
  tone = "violet",
}: {
  row: WidgetRow;
  compact?: boolean;
  tone?: Tone;
}) {
  const t = useRootT();
  const text = useFigureText();
  const nameOf = useRowName();
  const name = nameOf(row);
  const sub = row.sub ?? (row.subLabel ? t(row.subLabel, row.subValues) : undefined);
  const trail =
    row.value !== undefined
      ? text(row.value, row.unit, row.currency)
      : row.at
        ? formatDateTime(new Date(row.at), ADMIN_FORMAT_SETTINGS)
        : undefined;
  if (row.ratio !== undefined && !compact) {
    return (
      <Bar
        label={sub ? `${name} · ${sub}` : name}
        value={trail ?? ""}
        ratio={row.ratio}
        tone={row.status ? STATUS_TONE[row.status] : tone}
        href={row.href}
      />
    );
  }
  return (
    <Row
      href={row.href}
      mark={row.status ? STATUS_TONE[row.status] : undefined}
      trail={
        trail ? (
          <span className={cn("text-ink-soft", row.status && row.status !== "good" && STATUS_TEXT[row.status])}>
            {trail}
          </span>
        ) : undefined
      }
      className={compact ? "min-h-8 [&>a]:min-h-8 [&>div]:min-h-8" : undefined}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{name}</span>
        {sub && !compact && <span className="truncate text-xs text-ink-muted">{sub}</span>}
      </span>
    </Row>
  );
}

/**
 * Rows of states as a strip of dots with their names (health, what waits):
 * green, gold, pink. One glance says which part needs a hand.
 */
function StatusDots({
  rows,
  names = true,
  label,
  className,
}: {
  rows: WidgetRow[];
  names?: boolean;
  label: string;
  className?: string;
}) {
  const nameOf = useRowName();
  const text = useFigureText();
  // What needs a hand first; on a narrow widget (a phone) the calm parts are bare dots on one line.
  const ordered = [...rows].sort((a, b) => rank(a.status) - rank(b.status));
  return (
    <ul
      role="img"
      aria-label={label}
      className={cn("flex min-w-0 flex-wrap gap-x-3 gap-y-1 @max-md:flex-nowrap @max-md:overflow-hidden", className)}
    >
      {ordered.map((row) => {
        const calm = !row.status || row.status === "good";
        return (
          <li key={row.id} className="flex min-w-0 shrink-0 items-center gap-1.5 text-xs text-ink-soft">
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                row.status ? toneFill[STATUS_TONE[row.status]] : "bg-ink-muted",
                row.status === "bad" && "ring-3 ring-pink/25",
              )}
            />
            {names && <span className={cn("truncate", calm && "hidden @md:inline")}>{nameOf(row)}</span>}
            {row.value !== undefined && (
              <span
                className={cn(
                  "shrink-0 font-semibold text-ink tabular-nums",
                  calm && "hidden @md:inline",
                  row.status && row.status !== "good" && STATUS_TEXT[row.status],
                )}
              >
                {text(row.value, row.unit, row.currency)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const rank = (status: WidgetStatus | undefined) => (status === "bad" ? 0 : status === "warn" ? 1 : 2);

/** A list in the widget's shape: bars when every row has a share, rows otherwise. */
export function Rows({
  rows,
  limit,
  compact,
  tone = "violet",
}: {
  rows: WidgetRow[];
  limit: number;
  compact?: boolean;
  tone?: Tone;
}) {
  const shown = rows.slice(0, limit);
  if (shown.length === 0) return null;
  const bars = shown.every((row) => row.ratio !== undefined) && !compact;
  if (bars) {
    return (
      <ul className="flex min-h-0 flex-col gap-1.5 overflow-hidden">
        {shown.map((row) => (
          <WidgetRowItem key={row.id} row={row} tone={tone} />
        ))}
      </ul>
    );
  }
  return (
    <RowList>
      {shown.map((row) => (
        <WidgetRowItem key={row.id} row={row} compact={compact} tone={tone} />
      ))}
    </RowList>
  );
}

/**
 * A gauge: how far along a cap or a threshold a number is. The track is the
 * surface, the fill the state's colour, a tick marks the warning share. Reads
 * as one line, so a medium widget has room for it under its number.
 */
export function Gauge({
  value,
  max,
  warnAt,
  status,
  tone,
  label,
  className,
}: {
  value: number;
  max: number;
  /** 0–1 of the track where the warning starts. */
  warnAt?: number | null;
  status?: WidgetStatus;
  tone: Tone;
  label: string;
  className?: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const fill = status && status !== "good" ? toneFill[STATUS_TONE[status]] : toneFill[tone];
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-surface-hover", className)}
    >
      <span
        className={cn("block h-full rounded-full transition-[width] duration-700 ease-out", fill)}
        style={{ width: `${Math.max(ratio > 0 ? 1.5 : 0, ratio * 100)}%` }}
      />
      {warnAt !== undefined && warnAt !== null && warnAt > 0 && warnAt < 1 && (
        <span
          aria-hidden
          className="absolute top-0 h-full w-px bg-ink/50"
          style={{ left: `${warnAt * 100}%` }}
        />
      )}
    </div>
  );
}

/** A sparkline of raw values: scaled to the kit's 0–1, a flat line in the middle. */
export function Trend({
  values,
  tone,
  label,
  className,
}: {
  values: readonly (number | null)[];
  tone: Tone;
  label: string;
  className?: string;
}) {
  const scaled = useMemo(() => {
    const numbers = values.filter((value): value is number => value !== null);
    if (numbers.length < 2) return null;
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    const span = max - min;
    return values.map((value) => (value === null ? null : span > 0 ? (value - min) / span : 0.5));
  }, [values]);
  if (!scaled) return null;
  return <Sparkline values={scaled} tone={tone} label={label} className={cn("h-6 @md:h-9", className)} />;
}

/** The days of a chart's first series as columns (the last `days`, or all), today at the end in the accent. */
export function ChartColumns({
  chart,
  tone,
  days,
  height,
  labels = false,
  seriesKey,
}: {
  chart: ChartData;
  tone: Tone;
  days?: number;
  height?: number;
  /** The first and the last day under the columns. */
  labels?: boolean;
  seriesKey?: string;
}) {
  const t = useRootT();
  const series = chart.series.find((entry) => entry.key === seriesKey) ?? chart.series[0];
  if (!series) return null;
  const rows = days ? chart.rows.slice(-days) : chart.rows;
  if (rows.length < 2) return null;
  const values = rows.map((row) => {
    const value = row[series.key];
    return typeof value === "number" ? Math.max(0, value) : 0;
  });
  const name = series.label ? t(`admin.${series.label.key}`, series.label.values) : t(`metrics.items.${series.key}.name`);
  const day = (index: number) => formatDayMonth(rows[index].x as IsoDate, ADMIN_FORMAT_SETTINGS);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Columns values={values} tone={tone} label={name} current={values.length - 1} height={height ?? 48} className="min-w-0" />
      {labels && (
        <div className="flex justify-between text-[10px] text-ink-muted tabular-nums" aria-hidden>
          <span>{day(0)}</span>
          <span className="font-semibold text-ink">{day(rows.length - 1)}</span>
        </div>
      )}
    </div>
  );
}

/** The widget's own "Open section": one small action along the bottom of a tall widget. */
function OpenAction({ widgetKey, extra = [] }: { widgetKey?: string; extra?: readonly { label: string; href: string }[] }) {
  const t = useTranslations("dashboard.board");
  const href = widgetKey ? adminWidgetMeta(widgetKey)?.href : undefined;
  const items = [...(href ? [{ label: t("openSection"), href }] : []), ...extra];
  if (items.length === 0) return null;
  return <Actions items={items} />;
}

function Nothing({ size }: { size: WidgetSize }) {
  const t = useTranslations("admin.widgets.board");
  return <Empty icon={InboxIcon} title={t("empty")} hint={size === "S" ? undefined : t("emptyHint")} compact={size === "S"} />;
}

/** The figure with a trend of days, when any has one. */
function sparked(figures: WidgetFigure[]): WidgetFigure | undefined {
  return figures.find((figure) => figure.spark && figure.spark.filter((value) => value !== null).length >= 2);
}

// ---------------------------------------------------------------------------
// The standard composition
// ---------------------------------------------------------------------------

export type StandardViewProps = WidgetViewProps<AdminWidgetData> & { widgetKey?: string };

/** What the widget's rows are: states (health), a ranking (shares), or plain lines. */
function rowsKind(rows: WidgetRow[]): "states" | "ranked" | "plain" {
  if (rows.length === 0) return "plain";
  if (rows.every((row) => row.status !== undefined && row.ratio === undefined)) return "states";
  if (rows.every((row) => row.ratio !== undefined)) return "ranked";
  return "plain";
}

export function StandardView(props: StandardViewProps) {
  const { size, data, tone, widgetKey } = props;
  const t = useRootT();
  const tBoard = useTranslations("admin.widgets.board");
  const [main, ...rest] = data.figures;
  const rows = data.rows ?? [];
  const kind = rowsKind(rows);
  if (!main && rows.length === 0) return <Nothing size={size} />;
  const testBadge = data.testData ? <TestDataBadge /> : null;
  const trendLabel = tBoard("trend");
  const trend = sparked(data.figures);

  if (!main) {
    // A list widget (recent sign-ups, the audit): rows only, denser the smaller it is.
    return (
      <Stack>
        <Rows rows={rows} limit={size === "XL" ? 8 : size === "L" ? 6 : 2} compact={size === "M"} tone={tone} />
        {size !== "M" && <OpenAction widgetKey={widgetKey} />}
      </Stack>
    );
  }

  if (size === "S") {
    return (
      <Stack between>
        <MainFigure figure={main} trail={testBadge} />
        {kind === "states" && <StatusDots rows={rows} names={false} label={t(main.label, main.labelValues)} />}
      </Stack>
    );
  }

  if (size === "M") {
    return (
      <Stack between>
        <MainFigure figure={main} size="md" trail={testBadge} />
        {kind === "states" ? (
          <StatusDots rows={rows} label={t(main.label, main.labelValues)} />
        ) : trend ? (
          <Trend values={trend.spark ?? []} tone={tone} label={trendLabel} />
        ) : data.chart ? (
          <ChartColumns chart={data.chart} tone={tone} days={14} height={28} />
        ) : rest.length > 0 ? (
          <Ribbon figures={rest} max={3} />
        ) : kind === "ranked" ? (
          <RankedInline rows={rows} tone={tone} />
        ) : (
          <Rows rows={rows} limit={1} compact tone={tone} />
        )}
      </Stack>
    );
  }

  if (size === "L") {
    return (
      <Stack className="gap-2.5">
        <MainFigure figure={main} size="md" trail={testBadge} />
        {rest.length > 0 && <Ribbon figures={rest} max={3} />}
        {rows.length > 0 ? (
          <Rows rows={rows} limit={rest.length > 0 ? 4 : 5} tone={tone} />
        ) : data.chart ? (
          <ChartColumns chart={data.chart} tone={tone} days={30} height={64} labels />
        ) : trend ? (
          <Trend values={trend.spark ?? []} tone={tone} label={trendLabel} className="h-14 @md:h-16" />
        ) : null}
        <OpenAction widgetKey={widgetKey} />
      </Stack>
    );
  }

  // XL: the figures in a row, the chart over the period beside the list.
  return (
    <Stack className="gap-3">
      <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        <MainFigure figure={main} size="md" trail={testBadge} />
        {rest.slice(0, 3).map((figure) => (
          <MiniFigure key={figure.key} figure={figure} className="self-end" />
        ))}
      </div>
      <div className={cn("grid min-h-0 flex-1 gap-x-6 gap-y-3", (data.chart || trend) && rows.length > 0 && "@2xl:grid-cols-2")}>
        {data.chart ? (
          <ChartColumns chart={data.chart} tone={tone} height={88} labels />
        ) : trend ? (
          <Trend values={trend.spark ?? []} tone={tone} label={trendLabel} className="h-20" />
        ) : null}
        {rows.length > 0 &&
          (data.chart || trend ? (
            <Rows rows={rows} limit={5} tone={tone} />
          ) : (
            <div className="grid min-h-0 gap-x-6 @2xl:grid-cols-2">
              <Rows rows={rows.slice(0, 5)} limit={5} tone={tone} />
              <Rows rows={rows.slice(5, 10)} limit={5} tone={tone} />
            </div>
          ))}
      </div>
      <OpenAction widgetKey={widgetKey} />
    </Stack>
  );
}

/** The top of a ranking as one line with its shares: "Česko 10 · Slovensko 2". */
function RankedInline({ rows, tone }: { rows: WidgetRow[]; tone: Tone }) {
  const nameOf = useRowName();
  const text = useFigureText();
  const shown = rows.slice(0, 3);
  return (
    <ul className="flex min-w-0 flex-col gap-1">
      {shown.map((row, index) => (
        // A narrow widget (a phone) has room for two lines.
        <li key={row.id} className={cn("flex min-w-0 items-center gap-2 text-xs", index >= 2 && "hidden @md:flex")}>
          <span className="w-20 shrink-0 truncate text-ink-soft">{nameOf(row)}</span>
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
            <span
              className={cn("block h-full rounded-full", row.status ? toneFill[STATUS_TONE[row.status]] : toneFill[tone])}
              style={{ width: `${Math.max(2, Math.min(1, row.ratio ?? 0) * 100)}%` }}
            />
          </span>
          <span className="w-14 shrink-0 text-right font-semibold text-ink tabular-nums">
            {text(row.value, row.unit, row.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Widgets with a shape of their own
// ---------------------------------------------------------------------------

/** AI spend: the month's spend against the cap, as a gauge with the warning tick. */
export function AiSpendView(props: StandardViewProps) {
  const { size, data, tone } = props;
  const t = useTranslations("admin.widgets.aiSpend");
  const text = useFigureText();
  const by = (key: string) => data.figures.find((figure) => figure.key === key);
  const month = by("month");
  const cap = by("cap");
  const warn = by("warnAt");
  const share = by("share");
  const today = by("today");
  if (!month || !cap) return <StandardView {...props} />;
  const capValue = cap.value ?? 0;
  const gauge =
    capValue > 0 ? (
      <Gauge
        value={month.value ?? 0}
        max={capValue}
        warnAt={warn?.value ? warn.value / 100 : null}
        status={month.status}
        tone={tone}
        label={t("gauge", { spent: text(month.value, "usd"), cap: text(capValue, "usd") })}
      />
    ) : null;
  const capLine = (
    <p className="flex min-w-0 justify-between gap-x-3 overflow-hidden text-xs whitespace-nowrap text-ink-soft">
      <span className="truncate">
        {t("figures.today")}{" "}
        <span className="font-semibold text-ink tabular-nums">{text(today?.value, "usd")}</span>
      </span>
      <span>
        {t("figures.cap")}{" "}
        <span className="font-semibold text-ink tabular-nums">{text(capValue, "usd")}</span>
        {share?.value !== null && share?.value !== undefined && (
          <span className={cn("ml-1 tabular-nums", share.status && share.status !== "good" && STATUS_TEXT[share.status])}>
            · {text(share.value, "percent")}
          </span>
        )}
      </span>
    </p>
  );
  if (size === "S") {
    return (
      <Stack between>
        <MainFigure figure={month} sub={share?.value !== null && share?.value !== undefined ? t("ofCap", { share: text(share.value, "percent") }) : undefined} />
        {gauge}
      </Stack>
    );
  }
  if (size === "M") {
    return (
      <Stack between>
        <MainFigure figure={month} size="md" />
        <div className="flex flex-col gap-1">
          {gauge}
          {capLine}
        </div>
      </Stack>
    );
  }
  return (
    <Stack className="gap-2.5">
      <MainFigure figure={month} size="md" />
      {gauge}
      {capLine}
      <Rows rows={data.rows ?? []} limit={3} compact tone={tone} />
      <OpenAction widgetKey={props.widgetKey} />
    </Stack>
  );
}

/** Economy mode: the state in words over the share of the cap, the threshold as a tick. */
export function AiEconomyView(props: StandardViewProps) {
  const { size, data, tone } = props;
  const t = useRootT();
  const tBoard = useTranslations("admin.widgets.board");
  const text = useFigureText();
  const state = data.figures[0];
  const threshold = (data.rows ?? []).find((row) => row.id === "threshold");
  if (!state) return <Nothing size={size} />;
  const gauge =
    state.value !== null ? (
      <Gauge
        value={state.value}
        max={100}
        warnAt={threshold?.value ? threshold.value / 100 : null}
        status={state.status}
        tone={tone}
        label={tBoard("trend")}
      />
    ) : null;
  return (
    <Stack between>
      <MainFigure figure={state} size={size === "S" ? "lg" : "md"} />
      <div className="flex flex-col gap-1">
        {gauge}
        {size !== "S" && threshold && (
          <p className="text-xs text-ink-soft">
            {t(threshold.label ?? "", threshold.labelValues)}{" "}
            <span className="font-semibold text-ink tabular-nums">{text(threshold.value, threshold.unit)}</span>
          </p>
        )}
      </div>
    </Stack>
  );
}

/** The last deployment: the version in mono under the count of errors since it. */
export function DeployView(props: StandardViewProps) {
  const { size, data } = props;
  const t = useRootT();
  const [errors, occurrences] = data.figures;
  const version = (data.rows ?? []).find((row) => row.id === "version");
  const message = (data.rows ?? []).find((row) => row.id === "message");
  if (!errors) return <Nothing size={size} />;
  return (
    <Stack between>
      <MainFigure figure={errors} size={size === "S" ? "lg" : "md"} />
      <div className="flex min-w-0 flex-col gap-0.5">
        {version && (
          <p className="flex min-w-0 items-baseline gap-2 text-xs text-ink-soft">
            <code className="truncate font-mono text-ink">{version.text}</code>
            {version.subLabel && <span className="shrink-0">{t(version.subLabel)}</span>}
            {size !== "S" && occurrences && (
              <span className="ml-auto shrink-0 tabular-nums">
                <span className="font-semibold text-ink">{formatNumber(occurrences.value ?? 0, {}, ADMIN_FORMAT_SETTINGS)}</span>{" "}
                {t(occurrences.label, occurrences.labelValues)}
              </span>
            )}
          </p>
        )}
        {size !== "S" && message && <p className="truncate text-xs text-ink-muted">{message.text}</p>}
      </div>
    </Stack>
  );
}

/** The opened widget: every figure, the full chart, the lists. */
export function StandardDetail({ data, children }: WidgetDetailProps<AdminWidgetData> & { children?: ReactNode }) {
  const t = useRootT();
  const text = useFigureText();
  const rows = data.rows ?? [];
  const more = data.more ?? [];
  return (
    <div className="flex flex-col gap-5" data-testid="admin-widget-detail">
      {data.testData && <TestDataBadge />}
      {data.figures.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {data.figures.map((figure) => (
            <Figure
              key={figure.key}
              label={t(figure.label, figure.labelValues)}
              value={
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className={cn(figure.status && figure.status !== "good" && STATUS_TEXT[figure.status])}>
                    {text(figure.value, figure.unit, figure.currency)}
                  </span>
                  <FigureChange figure={figure} />
                </span>
              }
            />
          ))}
        </div>
      )}
      {children}
      {data.chart && data.chart.rows.length > 1 && (
        <AdminChart data={data.chart} title={t(`metrics.items.${data.chart.series[0]?.key}.name`)} height={240} />
      )}
      {rows.length > 0 && (
        <section className="flex flex-col gap-2">
          {data.rowsTitle && <DetailHeading>{t(data.rowsTitle)}</DetailHeading>}
          <Rows rows={rows} limit={50} />
        </section>
      )}
      {more.length > 0 && (
        <section className="flex flex-col gap-2">
          {data.moreTitle && <DetailHeading>{t(data.moreTitle)}</DetailHeading>}
          <Rows rows={more} limit={50} />
        </section>
      )}
      {data.figures.length === 0 && rows.length === 0 && more.length === 0 && (
        <Sub>{t("admin.widgets.board.empty")}</Sub>
      )}
    </div>
  );
}
