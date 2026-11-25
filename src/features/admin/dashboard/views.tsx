"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { FlaskConicalIcon, InboxIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Tone } from "@/components/ui/tone";
import {
  Bar,
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
import { formatDateTime, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "../format-metric";
import { ChangeBadge } from "../ui/metric-tile";
import { useBreakdownLabel } from "../ui/data-blocks";
import type { AdminWidgetData, WidgetFigure, WidgetRow, WidgetStatus } from "./data";

// The full chart (zoom, export) only in a detail or a wide widget.
const AdminChart = dynamic(() => import("../ui/admin-chart").then((module) => module.AdminChart), {
  ssr: false,
});

/**
 * How every widget of the overview draws its numbers (29.2): one anatomy,
 * per size, from the plain data of the route (data.ts). S = the one number
 * and its state; M = the number, the change against the period before and
 * its context (a trend or the next figures); L = the number with the other
 * figures and a list; XL = the figures in a row and a chart or a list in two
 * columns. The detail has everything. Text and numbers come formatted only
 * through format.ts and the administration's units.
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

const STATUS_TONE: Record<WidgetStatus, Tone> = { good: "green", warn: "gold", bad: "pink" };

/** "Test data": Stripe's test mode, the payments of internal accounts. */
export function TestDataBadge() {
  const t = useTranslations("admin.widgets.board");
  return (
    <span
      className="inline-flex w-fit items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[11px] font-medium text-gold"
      data-testid="widget-test-data"
    >
      <FlaskConicalIcon aria-hidden className="size-3" />
      {t("testData")}
    </span>
  );
}

function FigureLine({ figure }: { figure: WidgetFigure }) {
  const t = useRootT();
  const text = useFigureText();
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 text-xs text-ink-soft">
      <span className="truncate">{t(figure.label, figure.labelValues)}</span>
      <span
        className={cn(
          "shrink-0 font-semibold text-ink tabular-nums",
          figure.status === "bad" && "text-pink",
          figure.status === "warn" && "text-gold",
        )}
      >
        {text(figure.value, figure.unit, figure.currency)}
      </span>
    </span>
  );
}

function MainFigure({ figure, size = "lg" }: { figure: WidgetFigure; size?: "lg" | "md" }) {
  const t = useRootT();
  const text = useFigureText();
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2" data-widget-figure={figure.key}>
        <Hero size={size} status={figure.status}>
          {text(figure.value, figure.unit, figure.currency)}
        </Hero>
        <ChangeBadge
          current={figure.value}
          previous={figure.previous}
          lowerIsBetter={figure.lowerIsBetter}
        />
      </div>
      <Sub>{t(figure.label, figure.labelValues)}</Sub>
    </>
  );
}

/** One line of a list: its name, a second line, its value or moment, a state dot or a bar. */
export function WidgetRowItem({ row, compact = false }: { row: WidgetRow; compact?: boolean }) {
  const t = useRootT();
  const text = useFigureText();
  const itemLabel = useBreakdownLabel();
  const name = row.text ?? (row.label ? t(row.label, row.labelValues) : row.item ? itemLabel(row.item.metric, row.item.key) : row.id);
  const sub = row.sub ?? (row.subLabel ? t(row.subLabel, row.subValues) : undefined);
  const trail =
    row.value !== undefined
      ? text(row.value, row.unit, row.currency)
      : row.at
        ? formatDateTime(new Date(row.at), ADMIN_FORMAT_SETTINGS)
        : undefined;
  if (row.ratio !== undefined && !compact) {
    return <Bar label={name} value={trail ?? ""} ratio={row.ratio} tone={row.status ? STATUS_TONE[row.status] : "violet"} href={row.href} />;
  }
  return (
    <Row
      href={row.href}
      mark={row.status ? STATUS_TONE[row.status] : undefined}
      trail={trail ? <span className="text-ink-soft">{trail}</span> : undefined}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{name}</span>
        {sub && !compact && <span className="truncate text-xs text-ink-muted">{sub}</span>}
      </span>
    </Row>
  );
}

/** A list as one line under the number (a medium widget has no room for rows): "Cron · Stripe". */
function RowsInline({ rows }: { rows: WidgetRow[] }) {
  const t = useRootT();
  const text = useFigureText();
  const itemLabel = useBreakdownLabel();
  // What needs attention first; a list of states shows only those.
  const flagged = rows.filter((row) => row.status === "bad" || row.status === "warn");
  const shown = (rows.some((row) => row.status) ? flagged : rows).slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <p className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-soft">
      {shown.map((row) => (
        <span key={row.id} className="flex min-w-0 items-baseline gap-1">
          {row.status && (
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 self-center rounded-full",
                row.status === "bad" ? "bg-pink" : row.status === "warn" ? "bg-gold" : "bg-green",
              )}
            />
          )}
          <span className="truncate">
            {row.text ?? (row.label ? t(row.label, row.labelValues) : row.item ? itemLabel(row.item.metric, row.item.key) : row.id)}
          </span>
          {row.value !== undefined && (
            <span className="shrink-0 font-semibold text-ink tabular-nums">
              {text(row.value, row.unit, row.currency)}
            </span>
          )}
        </span>
      ))}
    </p>
  );
}

function Rows({ rows, limit, compact }: { rows: WidgetRow[]; limit: number; compact?: boolean }) {
  const shown = rows.slice(0, limit);
  if (shown.length === 0) return null;
  const bars = shown.every((row) => row.ratio !== undefined) && !compact;
  if (bars) {
    return (
      <ul className="flex min-h-0 flex-col gap-2 overflow-hidden">
        {shown.map((row) => (
          <WidgetRowItem key={row.id} row={row} />
        ))}
      </ul>
    );
  }
  return (
    <RowList>
      {shown.map((row) => (
        <WidgetRowItem key={row.id} row={row} compact={compact} />
      ))}
    </RowList>
  );
}

function Nothing({ size }: { size: WidgetViewProps<AdminWidgetData>["size"] }) {
  const t = useTranslations("admin.widgets.board");
  return <Empty icon={InboxIcon} title={t("empty")} hint={size === "S" ? undefined : t("emptyHint")} compact={size === "S"} />;
}

/** A small chart of the main figure's days, when it has them. */
function Trend({ figure, tone, label }: { figure: WidgetFigure | undefined; tone: Tone; label: string }) {
  const values = figure?.spark;
  if (!values || values.filter((value) => value !== null).length < 2) return null;
  return <Sparkline values={values} tone={tone} label={label} className="h-9" />;
}

export function StandardView({ size, data, tone }: WidgetViewProps<AdminWidgetData>) {
  const t = useRootT();
  const [main, ...rest] = data.figures;
  const rows = data.rows ?? [];
  if (!main && rows.length === 0) return <Nothing size={size} />;
  const testBadge = data.testData ? <TestDataBadge /> : null;
  const trendLabel = main ? t(main.label, main.labelValues) : "";

  if (!main) {
    // A list widget (recent sign-ups, the audit).
    return <Rows rows={rows} limit={size === "XL" || size === "L" ? 7 : 2} compact={size === "M"} />;
  }

  if (size === "S") {
    return (
      <Stack>
        <MainFigure figure={main} />
        {testBadge}
      </Stack>
    );
  }

  if (size === "M") {
    const sparked = main.spark ? main : rest.find((figure) => figure.spark);
    return (
      <Stack between>
        <div className="flex min-w-0 flex-col gap-1">
          <MainFigure figure={main} />
          {testBadge}
        </div>
        {rest.length > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-0.5">
            {rest.slice(0, 2).map((figure) => (
              <FigureLine key={figure.key} figure={figure} />
            ))}
          </div>
        ) : sparked ? (
          <Trend figure={sparked} tone={tone} label={trendLabel} />
        ) : (
          <RowsInline rows={rows} />
        )}
      </Stack>
    );
  }

  if (size === "L") {
    return (
      <Stack className="gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <MainFigure figure={main} />
          {testBadge}
        </div>
        {rest.length > 0 &&
          (rows.length > 0 ? (
            <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-0.5">
              {rest.slice(0, 3).map((figure) => (
                <FigureLine key={figure.key} figure={figure} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {rest.slice(0, 3).map((figure) => (
                <MiniFigure key={figure.key} figure={figure} />
              ))}
            </div>
          ))}
        {rows.length > 0 ? (
          <Rows rows={rows} limit={rest.length > 0 ? 3 : 5} />
        ) : (
          <Trend figure={main.spark ? main : rest.find((figure) => figure.spark)} tone={tone} label={trendLabel} />
        )}
      </Stack>
    );
  }

  // XL
  return (
    <Stack className="gap-3">
      <div className="flex flex-wrap items-center gap-2">{testBadge}</div>
      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
        {data.figures.slice(0, 4).map((figure, index) =>
          index === 0 ? (
            <div key={figure.key} className="flex min-w-0 flex-col gap-1">
              <MainFigure figure={figure} size="md" />
            </div>
          ) : (
            <MiniFigure key={figure.key} figure={figure} />
          ),
        )}
      </div>
      {data.chart ? (
        <ChartColumns data={data} tone={tone} />
      ) : (
        <div className="grid min-h-0 grid-cols-1 gap-x-6 @2xl:grid-cols-2">
          <Rows rows={rows.slice(0, 4)} limit={4} />
          <Rows rows={rows.slice(4)} limit={4} />
        </div>
      )}
    </Stack>
  );
}

/** The first series of the widget's chart as columns (the full chart is in the detail). */
function ChartColumns({ data, tone }: { data: AdminWidgetData; tone: Tone }) {
  const t = useRootT();
  const series = data.chart?.series[0];
  if (!data.chart || !series) return null;
  const values = data.chart.rows.map((row) => {
    const value = row[series.key];
    return typeof value === "number" ? value : null;
  });
  return (
    <Sparkline
      values={values}
      tone={tone}
      label={t(`metrics.items.${series.key}.name`)}
      className="h-16"
    />
  );
}

function MiniFigure({ figure }: { figure: WidgetFigure }) {
  const t = useRootT();
  const text = useFigureText();
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-line px-2.5 py-2">
      <span className="truncate text-[11px] text-ink-muted">{t(figure.label, figure.labelValues)}</span>
      <span
        className={cn(
          "truncate text-base font-semibold text-ink tabular-nums",
          figure.status === "bad" && "text-pink",
          figure.status === "warn" && "text-gold",
          figure.status === "good" && "text-green",
        )}
      >
        {text(figure.value, figure.unit, figure.currency)}
      </span>
    </div>
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
                  {text(figure.value, figure.unit, figure.currency)}
                  <ChangeBadge
                    current={figure.value}
                    previous={figure.previous}
                    lowerIsBetter={figure.lowerIsBetter}
                  />
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
