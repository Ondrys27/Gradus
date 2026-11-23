"use client";

import { useQuery } from "@tanstack/react-query";
import { addMonths, startOfMonth } from "date-fns";
import {
  CalendarCheckIcon,
  CheckCircle2Icon,
  KanbanSquareIcon,
  PlusIcon,
  UserPlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { Tone } from "@/components/ui/tone";
import { useSession } from "@/features/account/queries";
import { useWorkspaceId } from "@/features/account/workspace-queries";
import { dayRangeToInstants } from "@/features/calendar/calendar-logic";
import { contactName } from "@/features/contacts/types";
import { summarize, toBars } from "@/features/cold-calling/stats-logic";
import { useTimerReading } from "@/features/cold-calling/timer-queries";
import {
  dashboardKeys,
  useNewContactCount,
  useNewContacts,
  usePreviousMonthContactCount,
  useToday,
  useWeekProspecting,
} from "@/features/dashboard/queries";
import {
  compareToPrevious,
  winRate,
  winRateSeries,
  WIN_RATE_DAYS,
  type ClosedDeal,
  type WinRate,
} from "@/features/dashboard/dashboard-logic";
import {
  NewContactsDetail,
  ProspectingDetail,
  WinRateDetail,
} from "@/features/dashboard/tile-detail";
import { contactLabel, sortStages, sumByCurrency } from "@/features/pipeline/board-logic";
import { PipelineHealthTiles, pipelineTileHref } from "@/features/pipeline/dashboard-health";
import {
  HEALTH_TILES,
  healthLevel,
  type HealthLevel,
  type HealthRow,
  type HealthTile,
  type PipelineHealth,
} from "@/features/pipeline/health";
import { usePipelineHealth } from "@/features/pipeline/use-pipeline-health";
import { useDeals, useStages } from "@/features/pipeline/queries";
import { stageTone, type Stage } from "@/features/pipeline/types";
import { useWaitingBookings } from "@/features/scheduler/booking-queries";
import { bookingAppPath } from "@/features/scheduler/booking/paths";
import { useBookings } from "@/features/scheduler/queries";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import {
  formatCurrency,
  formatDayMonth,
  formatMonthShort,
  formatNumber,
  formatTime,
  formatWeekdayShort,
  instantToZonedParts,
  isoDateToLocal,
  localToIsoDate,
  splitDuration,
  type IsoDate,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  Actions,
  Bar,
  Columns,
  combine,
  defineWidget,
  Delta,
  DetailHeading,
  Empty,
  Figure,
  Hero,
  Legend,
  LiveNumber,
  Row,
  RowList,
  Segments,
  Sparkline,
  Stack,
  Sub,
  type WidgetQuery,
  type WidgetViewProps,
} from "../kit";

const PIPELINE_PATH = "/app/pipeline";
const NEW_DEAL_HREF = `${PIPELINE_PATH}?new=deal`;
const NEW_CONTACT_HREF = "/app/kontakty?new=contact";
const SCHEDULER_HREF = "/app/planovac";

/** The pipeline with one deal open (the calendar and the tiles link the same way). */
function dealHref(dealId: string) {
  return `${PIPELINE_PATH}?deal=${dealId}`;
}

/** A hero beside its line, in one row: the wide sizes keep the number small and to the side. */
function Header({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
      <Hero size="md">{hero}</Hero>
    </div>
  );
}

/** A small gold chip: something waits, which is neither good nor bad news yet. */
function WaitChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-gold/12 px-2 py-0.5 text-xs font-medium text-gold tabular-nums">
      <span className="truncate">{children}</span>
    </span>
  );
}

/** The signed change for a Delta: the difference with the direction's sign. */
function signedChange(current: number, previous: number) {
  const change = compareToPrevious(current, previous);
  return {
    ...change,
    value: change.direction === "down" ? -change.difference : change.difference,
  };
}

// ---------------------------------------------------------------------------
// Pipeline: open deals by stage, as value (with the right to see amounts) or count
// ---------------------------------------------------------------------------

type StageSum = {
  id: string;
  name: string;
  tone: Tone;
  count: number;
  totals: { currency: string; total: number }[];
};
type PipelineData = {
  stages: StageSum[];
  count: number;
  /** Per currency, the largest first; currencies are never added up. */
  totals: { currency: string; total: number }[];
};

function usePipelineData(): WidgetQuery<PipelineData> {
  const stages = useStages();
  const deals = useDeals();
  return combine([stages, deals], () => {
    const open = (deals.data ?? []).filter((deal) => !deal.won_at && !deal.lost_at);
    const rows = sortStages(stages.data ?? [])
      .filter((stage) => !stage.is_won && !stage.is_lost)
      .map((stage) => {
        const inStage = open.filter((deal) => deal.stage_id === stage.id);
        return {
          id: stage.id,
          name: stage.name,
          tone: stageTone(stage.color),
          count: inStage.length,
          totals: sumByCurrency(inStage).sort((a, b) => b.total - a.total),
        };
      });
    return {
      stages: rows,
      count: open.length,
      totals: sumByCurrency(open).sort((a, b) => b.total - a.total),
    };
  });
}

function stageValue(stage: StageSum, currency: string | undefined) {
  return stage.totals.find((total) => total.currency === currency)?.total ?? 0;
}

/** At most this many stages as bars in the tall widget; the wide one has room for all. */
const BARS_IN_L = 6;

function PipelineView({ size, data, settings }: WidgetViewProps<PipelineData>) {
  const t = useTranslations("dashboard.widgets.pipeline");
  const format = useFormatSettings();
  const wide = size === "L" || size === "XL";
  if (data.count === 0) {
    return (
      <Empty
        icon={KanbanSquareIcon}
        tone="violet"
        zero={formatNumber(0, {}, format)}
        title={t("emptyTitle")}
        hint={t("emptyHint")}
        action={{ label: t("newDeal"), href: NEW_DEAL_HREF }}
        compact={!wide}
      />
    );
  }
  const byValue = settings.measure !== "count" && data.totals.length > 0;
  const main = data.totals[0];
  const amountOf = (stage: StageSum) => (byValue ? stageValue(stage, main?.currency) : stage.count);
  const formatAmount = (amount: number) =>
    byValue && main
      ? formatCurrency(amount, main.currency, format)
      : formatNumber(amount, {}, format);
  const hero =
    byValue && main ? (
      <LiveNumber value={main.total} format={{ style: "currency", currency: main.currency }} />
    ) : (
      <LiveNumber value={data.count} />
    );
  const sub = byValue
    ? t("valueHint", { count: data.count })
    : t("countHint", { count: data.count });
  const otherCurrencies = byValue
    ? data.totals
        .slice(1)
        .map((total) => formatCurrency(total.total, total.currency, format))
        .join(" · ")
    : "";
  const others = otherCurrencies ? (
    <Sub className="text-xs text-ink-muted">
      {t("otherCurrencies", { amounts: otherCurrencies })}
    </Sub>
  ) : null;

  if (size === "S") {
    return (
      <Stack>
        <Hero>{hero}</Hero>
        <Sub>{sub}</Sub>
        {others}
      </Stack>
    );
  }
  if (size === "M") {
    return (
      <Stack between>
        <div className="flex flex-col gap-1.5">
          <Hero>{hero}</Hero>
          <Sub>{sub}</Sub>
        </div>
        <div className="flex flex-col gap-1.5">
          <Segments
            label={t("stagesLabel")}
            parts={data.stages.map((stage) => ({
              key: stage.id,
              value: amountOf(stage),
              tone: stage.tone,
            }))}
          />
          {others}
        </div>
      </Stack>
    );
  }

  const shown = size === "L" ? data.stages.slice(0, BARS_IN_L) : data.stages;
  const max = Math.max(1, ...shown.map(amountOf));
  return (
    <Stack className="gap-3">
      <Header hero={hero}>
        <Sub>{sub}</Sub>
        {others}
      </Header>
      <ul
        aria-label={t("stagesLabel")}
        className={cn("grid content-start gap-2", size === "XL" && "@3xl:grid-cols-2 @3xl:gap-x-6")}
      >
        {shown.map((stage) => (
          <Bar
            key={stage.id}
            label={stage.name}
            value={formatAmount(amountOf(stage))}
            ratio={amountOf(stage) / max}
            tone={stage.tone}
          />
        ))}
      </ul>
      {size === "XL" && byValue && (
        <Legend
          items={data.stages.map((stage) => ({
            key: stage.id,
            label: stage.name,
            tone: stage.tone,
            value: formatNumber(stage.count, {}, format),
          }))}
        />
      )}
      {size === "XL" && (
        <Actions
          items={[
            { label: t("newDeal"), href: NEW_DEAL_HREF, primary: true, icon: PlusIcon },
            { label: t("openPipeline"), href: PIPELINE_PATH },
          ]}
        />
      )}
    </Stack>
  );
}

export const pipelineWidget = defineWidget<PipelineData>({
  key: "pipeline",
  useData: usePipelineData,
  View: PipelineView,
  Detail: ({ data, settings }) => {
    const t = useTranslations("dashboard.widgets.pipeline");
    const format = useFormatSettings();
    const byValue = settings.measure !== "count";
    return (
      <div className="flex flex-col gap-4">
        <RowList>
          {data.stages.map((stage) => (
            <Row
              key={stage.id}
              mark={stage.tone}
              trail={
                <span className="text-ink">
                  {formatNumber(stage.count, {}, format)}
                  {byValue &&
                    stage.totals.map((total) => (
                      <span key={total.currency} className="ml-2 text-ink-soft">
                        {formatCurrency(total.total, total.currency, format)}
                      </span>
                    ))}
                </span>
              }
            >
              {stage.name}
            </Row>
          ))}
        </RowList>
        {byValue && data.totals.length > 0 && (
          <div className="flex flex-col gap-1">
            <DetailHeading>{t("totals")}</DetailHeading>
            <p className="text-sm text-ink">
              {data.totals
                .map((total) => formatCurrency(total.total, total.currency, format))
                .join(" · ")}
            </p>
          </div>
        )}
      </div>
    );
  },
});

// ---------------------------------------------------------------------------
// On fire: the three tiles of what is wrong in the pipeline (17.3)
// ---------------------------------------------------------------------------

type OnFireData = { health: PipelineHealth; stages: Stage[] };

function useOnFire(): WidgetQuery<OnFireData> {
  const { health, pending, failed, retry } = usePipelineHealth();
  const stages = useStages();
  const healthQuery = {
    data: health ?? undefined,
    isPending: pending,
    isError: failed,
    refetch: retry,
  };
  return combine([healthQuery, stages], () => ({ health: health!, stages: stages.data! }));
}

/** Green at zero, gold up to three, pink above (healthLevel). */
const LEVEL_TEXT: Record<HealthLevel, string> = {
  ok: "text-green",
  warn: "text-gold",
  alert: "text-pink",
};

/** How many deals of a tile the tall and wide sizes list. */
const FIRE_ROWS = 4;

/**
 * The three figures, each a link into the pipeline with that tile's list open.
 * They carry the same `data-tile` / `data-level` / `data-count` as the tiles
 * in the pipeline (`HealthTiles`), so the dashboard and the pipeline read alike.
 */
function HealthFigures({ health }: { health: PipelineHealth }) {
  const t = useTranslations("dashboard.widgets.onFire");
  const th = useTranslations("pipeline.health");
  const format = useFormatSettings();
  return (
    <ul aria-label={th("label")} className="grid grid-cols-3 gap-2">
      {HEALTH_TILES.map((tile) => {
        const count = health[tile].count;
        const level = healthLevel(count);
        return (
          <li key={tile} className="min-w-0">
            <Link
              href={pipelineTileHref(tile)}
              aria-label={th("openInPipeline", {
                label: th(`tiles.${tile}.label`),
                count: formatNumber(count, {}, format),
              })}
              data-tile={tile}
              data-level={level}
              data-count={count}
              onClick={() => track("pipeline_health_opened", { tile, from: "dashboard", count })}
              className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
            >
              <Figure
                label={t(`short.${tile}`)}
                value={<LiveNumber value={count} />}
                className={cn("tabular-nums", LEVEL_TEXT[level])}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function useProblemText() {
  const th = useTranslations("pipeline.health");
  const format = useFormatSettings();
  return (row: HealthRow): string => {
    const formatted = formatNumber(row.days, {}, format);
    switch (row.tile) {
      case "closePast":
        return th("row.closePast", { date: formatDayMonth(row.closeDate, format) });
      case "overdueTasks":
        return th("row.overdueTasks", {
          tasks: row.tasks,
          tasksFormatted: formatNumber(row.tasks, {}, format),
          days: row.days,
          formatted,
        });
      case "noTask":
        return th("row.noTask", { days: row.days, formatted });
    }
  };
}

function FireRows({ tile, data, limit }: { tile: HealthTile; data: OnFireData; limit: number }) {
  const th = useTranslations("pipeline.health");
  const problem = useProblemText();
  const stageById = new Map(data.stages.map((stage) => [stage.id, stage]));
  const rows = data.health[tile].rows.slice(0, limit);
  if (rows.length === 0) {
    return (
      <p className="flex min-h-9 items-center gap-1.5 text-xs text-green">
        <CheckCircle2Icon aria-hidden className="size-3.5 shrink-0" />
        {th("ok")}
      </p>
    );
  }
  return (
    <RowList>
      {rows.map((row) => {
        const stage = stageById.get(row.deal.stage_id);
        return (
          <Row
            key={row.deal.id}
            href={dealHref(row.deal.id)}
            mark={stage ? stageTone(stage.color) : "neutral"}
            trail={<span className="text-pink">{problem(row)}</span>}
          >
            {row.deal.title}
            {row.deal.contact && (
              <span className="text-ink-muted"> · {contactLabel(row.deal.contact)}</span>
            )}
          </Row>
        );
      })}
    </RowList>
  );
}

/** The tile with the most wrong in it, red before yellow. */
function worstTile(health: PipelineHealth): HealthTile {
  return [...HEALTH_TILES].sort((a, b) => health[b].count - health[a].count)[0];
}

function OnFireView({ size, data }: WidgetViewProps<OnFireData>) {
  const t = useTranslations("dashboard.widgets.onFire");
  const th = useTranslations("pipeline.health");
  const clear = HEALTH_TILES.every((tile) => data.health[tile].count === 0);
  const actions = size === "XL" && (
    <Actions items={[{ label: t("openPipeline"), href: PIPELINE_PATH }]} />
  );

  if (clear) {
    return (
      <Stack className="gap-3">
        <HealthFigures health={data.health} />
        <div
          className={cn(
            "flex items-center gap-2 text-sm font-medium text-green",
            size !== "M" && "flex-1 justify-center",
          )}
        >
          <CheckCircle2Icon aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{t("clear")}</span>
        </div>
        {actions}
      </Stack>
    );
  }
  if (size === "M") {
    return (
      <Stack between>
        <HealthFigures health={data.health} />
        <Sub className="text-xs text-ink-muted">{th(`tiles.${worstTile(data.health)}.hint`)}</Sub>
      </Stack>
    );
  }
  if (size === "L") {
    const tile = worstTile(data.health);
    return (
      <Stack className="gap-3">
        <HealthFigures health={data.health} />
        <div className="flex min-h-0 flex-col gap-1">
          <span className="micro-label">{th(`tiles.${tile}.label`)}</span>
          <FireRows tile={tile} data={data} limit={FIRE_ROWS} />
        </div>
      </Stack>
    );
  }
  return (
    <Stack className="gap-3">
      <HealthFigures health={data.health} />
      <div className="grid min-h-0 gap-3 @3xl:grid-cols-3 @3xl:gap-x-6">
        {HEALTH_TILES.map((tile) => (
          <div key={tile} className="flex min-w-0 flex-col gap-1">
            <span className="micro-label truncate">{th(`tiles.${tile}.label`)}</span>
            <FireRows tile={tile} data={data} limit={FIRE_ROWS} />
          </div>
        ))}
      </div>
      {actions}
    </Stack>
  );
}

export const onFireWidget = defineWidget<OnFireData>({
  key: "onFire",
  useData: useOnFire,
  View: OnFireView,
  Detail: () => <PipelineHealthTiles />,
});

// ---------------------------------------------------------------------------
// Win rate (the former tile): this window against the one before, and by month
// ---------------------------------------------------------------------------

const WIN_MONTHS = 6;
const CLOSED_WIDE_LIMIT = 2000;

type ClosedWide = ClosedDeal & { closedAt: string };

/** The months the chart shows, oldest first, as "YYYY-MM" in the user's zone. */
function lastMonths(today: IsoDate, count: number): string[] {
  const start = startOfMonth(isoDateToLocal(today));
  return Array.from({ length: count }, (_, index) =>
    localToIsoDate(addMonths(start, index - (count - 1))).slice(0, 7),
  );
}

/**
 * Deals closed in the last two windows (for the change) and the last six
 * months (for the columns): the two dates only. The 90-day query of the
 * section is too short for a comparison, so the widget reads its own.
 */
function useClosedDealsWide() {
  const { user } = useSession();
  const workspaceId = useWorkspaceId();
  const { today, timeZone } = useToday();
  return useQuery({
    staleTime: 0,
    queryKey: [...dashboardKeys.all(user.id), "closed-wide", today, timeZone] as const,
    queryFn: async (): Promise<ClosedWide[]> => {
      const firstMonth = `${lastMonths(today, WIN_MONTHS)[0]}-01`;
      const monthStart = dayRangeToInstants(firstMonth, firstMonth, timeZone).from;
      const windows = new Date(Date.now() - 2 * WIN_RATE_DAYS * 86_400_000).toISOString();
      const since = monthStart < windows ? monthStart : windows;
      const { data, error } = await createClient()
        .from("deals")
        .select("won_at, lost_at")
        .eq("user_id", workspaceId)
        .or(`won_at.gte.${since},lost_at.gte.${since}`)
        .limit(CLOSED_WIDE_LIMIT);
      if (error) throw error;
      return data.map((deal) => ({ ...deal, closedAt: (deal.won_at ?? deal.lost_at)! }));
    },
  });
}

type WinData = {
  current: WinRate;
  previous: WinRate;
  series: (number | null)[];
  /** Oldest first; `month` is "YYYY-MM". */
  months: { month: string; won: number; closed: number }[];
};

function useWinRate(): WidgetQuery<WinData> {
  const closed = useClosedDealsWide();
  const { today, timeZone } = useToday();
  return combine([closed], () => {
    const now = new Date();
    const deals = closed.data!;
    const windowStart = now.getTime() - WIN_RATE_DAYS * 86_400_000;
    const previousStart = windowStart - WIN_RATE_DAYS * 86_400_000;
    const current = winRate(deals, windowStart);
    const earlier = deals.filter((deal) => Date.parse(deal.closedAt) < windowStart);
    const previous = winRate(earlier, previousStart);
    const months = lastMonths(today, WIN_MONTHS).map((month) => ({ month, won: 0, closed: 0 }));
    const byMonth = new Map(months.map((entry) => [entry.month, entry]));
    for (const deal of deals) {
      const month = instantToZonedParts(new Date(deal.closedAt), timeZone).date.slice(0, 7);
      const entry = byMonth.get(month);
      if (!entry) continue;
      entry.closed += 1;
      if (deal.won_at) entry.won += 1;
    }
    return { current, previous, series: winRateSeries(deals, now), months };
  });
}

function WinRateView({ size, data, tone }: WidgetViewProps<WinData>) {
  const t = useTranslations("dashboard.tiles.winRate");
  const tw = useTranslations("dashboard.widgets.winRate");
  const format = useFormatSettings();
  const locale = useLocale();
  const days = formatNumber(WIN_RATE_DAYS, {}, format);
  const hasTrend = data.series.filter((value) => value !== null).length > 1;
  const columns = (height: number, labels: boolean) => (
    <Columns
      values={data.months.map((entry) => entry.won)}
      tone={tone}
      label={tw("byMonth")}
      current={data.months.length - 1}
      labels={
        labels
          ? data.months.map((entry) =>
              formatMonthShort(isoDateToLocal(`${entry.month}-01`), locale),
            )
          : undefined
      }
      height={height}
    />
  );

  if (data.current.rate === null) {
    const anyMonth = data.months.some((entry) => entry.closed > 0);
    return (
      <Stack between={size === "L"}>
        <div className="flex flex-col gap-1.5">
          <Hero className="text-ink-muted">
            <span aria-hidden>–</span>
            <span className="sr-only">{t("noData")}</span>
          </Hero>
          <Sub lines={size === "S" ? 1 : 2}>{t("empty", { days })}</Sub>
        </div>
        {size === "L" && anyMonth && columns(64, true)}
      </Stack>
    );
  }

  const hero = <LiveNumber value={data.current.rate} format={{ style: "percent" }} />;
  if (size === "S") {
    return (
      <Stack>
        <Hero>{hero}</Hero>
        <Sub>{tw("window", { days })}</Sub>
      </Stack>
    );
  }
  const change =
    data.previous.rate === null ? null : signedChange(data.current.rate, data.previous.rate);
  const delta = change && (
    <Delta direction={change.direction}>
      {tw("vsPrevious", {
        value: formatNumber(change.value, { style: "percent", signed: true }, format),
        days,
      })}
    </Delta>
  );
  if (size === "M") {
    return (
      <Stack between>
        <div className="flex flex-col gap-1.5">
          <Hero>{hero}</Hero>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {delta}
            <Sub className="flex-1">{tw("window", { days })}</Sub>
          </div>
        </div>
        {hasTrend && <Sparkline values={data.series} tone={tone} label={t("trend", { days })} />}
      </Stack>
    );
  }
  return (
    <Stack className="gap-3">
      <Header hero={hero}>
        <Sub>
          {t("hint", {
            won: formatNumber(data.current.won, {}, format),
            closed: formatNumber(data.current.won + data.current.lost, {}, format),
            days,
          })}
        </Sub>
        {delta && <div>{delta}</div>}
      </Header>
      {hasTrend && (
        <Sparkline values={data.series} tone={tone} label={t("trend", { days })} className="h-14" />
      )}
      <Legend
        items={[
          {
            key: "won",
            label: tw("won"),
            tone: "green",
            value: formatNumber(data.current.won, {}, format),
          },
          {
            key: "lost",
            label: tw("lost"),
            tone: "pink",
            value: formatNumber(data.current.lost, {}, format),
          },
        ]}
      />
      <div className="mt-auto">{columns(56, true)}</div>
    </Stack>
  );
}

export const winRateWidget = defineWidget<WinData>({
  key: "winRate",
  useData: useWinRate,
  View: WinRateView,
  Detail: () => <WinRateDetail />,
});

// ---------------------------------------------------------------------------
// New contacts this month (the former tile)
// ---------------------------------------------------------------------------

type ContactsData = {
  count: number;
  previous: number;
  latest: {
    id: string;
    company_name: string | null;
    first_name: string | null;
    last_name: string | null;
    created_at: string;
  }[];
};

function useNewContactsData(): WidgetQuery<ContactsData> {
  const count = useNewContactCount();
  const previous = usePreviousMonthContactCount();
  const latest = useNewContacts(true);
  return combine([count, previous, latest], () => ({
    count: count.data!,
    previous: previous.data!,
    latest: latest.data!,
  }));
}

const CONTACT_ROWS = 5;

function NewContactsView({ size, data }: WidgetViewProps<ContactsData>) {
  const t = useTranslations("dashboard.tiles.newContacts");
  const tw = useTranslations("dashboard.widgets.newContacts");
  const format = useFormatSettings();
  const name = (contact: ContactsData["latest"][number]) => contactName(contact) || tw("unnamed");
  if (data.count === 0) {
    return (
      <Empty
        icon={UserPlusIcon}
        zero={formatNumber(0, {}, format)}
        title={t("hint")}
        hint={tw("emptyTitle")}
        action={{ label: tw("add"), href: NEW_CONTACT_HREF }}
        compact={size === "S"}
      />
    );
  }
  const hero = <LiveNumber value={data.count} />;
  if (size === "S") {
    return (
      <Stack>
        <Hero>{hero}</Hero>
        <Sub>{t("hint")}</Sub>
      </Stack>
    );
  }
  if (size === "M") {
    const change = signedChange(data.count, data.previous);
    const latest = data.latest[0];
    // Three short lines, so nothing wraps out of a one-row widget on a phone.
    return (
      <Stack>
        <Hero unit={t("hint")}>{hero}</Hero>
        <div className="flex min-w-0 items-center gap-2">
          <Delta direction={change.direction}>
            {tw("vsLastMonth", { value: formatNumber(change.value, { signed: true }, format) })}
          </Delta>
          {latest && <Sub className="flex-1">{tw("latest", { name: name(latest) })}</Sub>}
        </div>
      </Stack>
    );
  }
  return (
    <Stack className="gap-3">
      <Header hero={hero}>
        <Sub>{t("hint")}</Sub>
      </Header>
      <RowList>
        {data.latest.slice(0, CONTACT_ROWS).map((contact) => (
          <Row
            key={contact.id}
            href={`/app/kontakty/${contact.id}`}
            lead={formatDayMonth(
              instantToZonedParts(new Date(contact.created_at), format.timeZone).date,
              format,
            )}
          >
            {name(contact)}
          </Row>
        ))}
      </RowList>
    </Stack>
  );
}

export const newContactsWidget = defineWidget<ContactsData>({
  key: "newContacts",
  useData: useNewContactsData,
  View: NewContactsView,
  Detail: () => <NewContactsDetail />,
});

// ---------------------------------------------------------------------------
// Cold calling: time spent finding clients today and this week
// ---------------------------------------------------------------------------

type CallingData = {
  today: number;
  week: number;
  bars: { key: IsoDate; value: number; current: boolean }[];
};

function useCalling(): WidgetQuery<CallingData> {
  const { query, range, today } = useWeekProspecting();
  const timer = useTimerReading();
  return combine([query, timer], () => ({
    today: timer.data!.todaySeconds,
    week: summarize(range, query.data!, today).total,
    bars: toBars("week", range, query.data!, today),
  }));
}

/** Hours and minutes as a hero: "1 h 25 min", or just the minutes under an hour. */
function DurationHero({ seconds, size }: { seconds: number; size?: "lg" | "md" }) {
  const t = useTranslations("dashboard.tiles.prospecting");
  const { hours, minutes } = splitDuration(seconds);
  return (
    <Hero size={size} unit={t("minutesUnit")}>
      {hours > 0 && (
        <>
          <LiveNumber value={hours} />
          <span className="mr-1.5 ml-1.5 text-[0.42em] font-semibold text-ink-soft">
            {t("hoursUnit")}
          </span>
        </>
      )}
      <LiveNumber value={minutes} />
    </Hero>
  );
}

function DurationText({ seconds }: { seconds: number }) {
  const t = useTranslations("dashboard.tiles.prospecting");
  const format = useFormatSettings();
  const { hours, minutes } = splitDuration(seconds);
  const parts = [
    hours > 0 ? `${formatNumber(hours, {}, format)} ${t("hoursUnit")}` : null,
    `${formatNumber(minutes, {}, format)} ${t("minutesUnit")}`,
  ].filter(Boolean);
  return <span className="font-medium text-ink tabular-nums">{parts.join(" ")}</span>;
}

function ColdCallingView({ size, data, tone }: WidgetViewProps<CallingData>) {
  const t = useTranslations("dashboard.widgets.coldCalling");
  const locale = useLocale();
  const current = data.bars.findIndex((bar) => bar.current);
  const week = (
    <Sub>
      {t("week")} <DurationText seconds={data.week} />
    </Sub>
  );
  if (size === "S") {
    return (
      <Stack>
        <DurationHero seconds={data.today} />
        <Sub>{t("today")}</Sub>
      </Stack>
    );
  }
  if (size === "M") {
    return (
      <Stack between>
        <div className="flex flex-col gap-1.5">
          <DurationHero seconds={data.today} />
          {week}
        </div>
        <Columns
          values={data.bars.map((bar) => bar.value)}
          tone={tone}
          label={t("weekChart")}
          current={current}
          height={36}
        />
      </Stack>
    );
  }
  return (
    <Stack className="gap-3">
      <Header hero={<DurationHero seconds={data.today} size="md" />}>
        <Sub>{t("today")}</Sub>
      </Header>
      <Columns
        className="mt-auto"
        values={data.bars.map((bar) => bar.value)}
        tone={tone}
        label={t("weekChart")}
        current={current}
        labels={data.bars.map((bar) => formatWeekdayShort(isoDateToLocal(bar.key), locale))}
        height={64}
      />
      {week}
    </Stack>
  );
}

export const coldCallingWidget = defineWidget<CallingData>({
  key: "coldCalling",
  useData: useCalling,
  View: ColdCallingView,
  Detail: () => <ProspectingDetail />,
});

// ---------------------------------------------------------------------------
// Bookings from the scheduler: the next ones and those waiting for approval
// ---------------------------------------------------------------------------

type BookingsData = {
  upcoming: { id: string; starts_at: string; guest_name: string | null; status: string }[];
  total: number;
  pending: number;
};

function useBookingsData(): WidgetQuery<BookingsData> {
  const bookings = useBookings({ scope: "mine", when: "upcoming", status: "all", page: 0 });
  const waiting = useWaitingBookings();
  return combine([bookings, waiting], () => ({
    upcoming: bookings.data!.rows.filter((row) => row.status !== "cancelled"),
    total: bookings.data!.total,
    pending: waiting.data!.length,
  }));
}

const BOOKING_ROWS = 4;

function BookingRow({
  booking,
  withStatus,
}: {
  booking: BookingsData["upcoming"][number];
  withStatus: boolean;
}) {
  const t = useTranslations("dashboard.widgets.bookings");
  const format = useFormatSettings();
  const starts = new Date(booking.starts_at);
  const day = instantToZonedParts(starts, format.timeZone).date;
  return (
    <Row
      href={bookingAppPath(booking.id)}
      lead={formatDayMonth(day, format)}
      trail={
        <>
          <span className="text-ink-soft">{formatTime(starts, format)}</span>
          {withStatus && booking.status === "pending" && (
            <span className="ml-1.5 text-gold">{t("toApprove")}</span>
          )}
        </>
      }
    >
      {booking.guest_name ?? t("guest")}
    </Row>
  );
}

function BookingsView({ size, data }: WidgetViewProps<BookingsData>) {
  const t = useTranslations("dashboard.widgets.bookings");
  const format = useFormatSettings();
  const count = data.upcoming.length;
  if (count === 0) {
    return (
      <Empty
        icon={CalendarCheckIcon}
        tone="teal"
        zero={formatNumber(0, {}, format)}
        title={t("upcoming", { count: 0 })}
        hint={t("emptyHint")}
        action={{ label: t("share"), href: SCHEDULER_HREF }}
        compact={size !== "L"}
      />
    );
  }
  const hero = <LiveNumber value={count} />;
  const pendingChip = data.pending > 0 && (
    <WaitChip>{t("pending", { count: data.pending })}</WaitChip>
  );
  if (size === "S") {
    return (
      <Stack>
        <Hero>{hero}</Hero>
        <Sub>
          {data.pending > 0 ? t("pending", { count: data.pending }) : t("upcoming", { count })}
        </Sub>
      </Stack>
    );
  }
  if (size === "M") {
    return (
      <Stack between>
        <div className="flex flex-col gap-1.5">
          <Hero>{hero}</Hero>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {pendingChip}
            <Sub className="flex-1">{t("upcoming", { count })}</Sub>
          </div>
        </div>
        <RowList>
          <BookingRow booking={data.upcoming[0]} withStatus={false} />
        </RowList>
      </Stack>
    );
  }
  return (
    <Stack className="gap-3">
      <Header hero={hero}>
        <Sub>{t("upcoming", { count })}</Sub>
        {pendingChip && <div>{pendingChip}</div>}
      </Header>
      <RowList>
        {data.upcoming.slice(0, BOOKING_ROWS).map((booking) => (
          <BookingRow key={booking.id} booking={booking} withStatus />
        ))}
      </RowList>
    </Stack>
  );
}

export const bookingsWidget = defineWidget<BookingsData>({
  key: "bookings",
  useData: useBookingsData,
  View: BookingsView,
  Detail: ({ data }) => {
    const t = useTranslations("dashboard.widgets.bookings");
    if (data.upcoming.length === 0) {
      return (
        <Empty icon={CalendarCheckIcon} tone="teal" title={t("emptyTitle")} hint={t("emptyHint")} />
      );
    }
    return (
      <RowList>
        {data.upcoming.map((booking) => (
          <BookingRow key={booking.id} booking={booking} withStatus />
        ))}
      </RowList>
    );
  },
});
