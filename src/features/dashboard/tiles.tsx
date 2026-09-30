"use client";

import { useEffect, useState } from "react";
import {
  BanknoteIcon,
  HandshakeIcon,
  ListChecksIcon,
  TargetIcon,
  TimerIcon,
  UserPlusIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Skeleton } from "@/components/ui/skeleton";
import { periodRange as weekRange, summarize } from "@/features/cold-calling/stats-logic";
import { useDailySeconds } from "@/features/cold-calling/stats-queries";
import { periodRange as monthRange } from "@/features/finance/finance-logic";
import { useTotals } from "@/features/finance/queries";
import { formatNumber, splitDuration } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import {
  compareToPrevious,
  taskCompletionRate,
  winRate,
  winRateSeries,
  WIN_RATE_DAYS,
} from "./dashboard-logic";
import { DashboardTile, TileNumber, Trend } from "./dashboard-tile";
import {
  useActiveDealCount,
  useClosedDeals,
  useNewContactCount,
  useStalledDeals,
  useTodayTasks,
  useToday,
} from "./queries";
import { Sparkline } from "./sparkline";

export const TILE_KEYS = [
  "income",
  "tasks",
  "winRate",
  "activeDeals",
  "newContacts",
  "prospecting",
] as const;
export type TileKey = (typeof TILE_KEYS)[number];

/** The `layoutId` shared between a tile card and its opened detail window. */
export function tileLayoutId(key: TileKey): string {
  return `dashboard-tile-${key}`;
}

type TileProps = { onOpen: () => void };

function TileError() {
  const t = useTranslations("dashboard.tiles");
  return <p className="text-sm text-pink">{t("loadFailed")}</p>;
}

function NumberSkeleton() {
  return <Skeleton className="h-10 w-2/3" />;
}

/** False on the first paint, true a frame later, so a bar or ring can grow from empty. */
function useAppeared() {
  const [appeared, setAppeared] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAppeared(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return appeared;
}

export function IncomeTile({ onOpen }: TileProps) {
  const t = useTranslations("dashboard.tiles.income");
  const settings = useFormatSettings();
  const { today } = useToday();
  const current = useTotals(monthRange("thisMonth", today), null);
  const previous = useTotals(monthRange("lastMonth", today), null);
  const failed = current.isError || previous.isError;

  const change =
    current.data && previous.data
      ? compareToPrevious(current.data.income, previous.data.income)
      : null;

  return (
    <DashboardTile
      label={t("label")}
      icon={<BanknoteIcon aria-hidden />}
      tone="green"
      layoutId={tileLayoutId("income")}
      onOpen={onOpen}
    >
      {failed ? (
        <TileError />
      ) : current.data ? (
        <>
          <TileNumber>
            <AnimatedNumber value={current.data.income} format={{ style: "currency" }} />
          </TileNumber>
          {change && (
            <Trend direction={change.direction}>
              {change.direction === "same"
                ? t("same")
                : t(change.direction, {
                    amount: formatNumber(
                      change.difference,
                      { style: "currency", decimals: Number.isInteger(change.difference) ? 0 : 2 },
                      settings,
                    ),
                  })}
            </Trend>
          )}
        </>
      ) : (
        <>
          <NumberSkeleton />
          <Skeleton className="h-5 w-1/2" />
        </>
      )}
    </DashboardTile>
  );
}

/** Mounted once the numbers are known, so the ring grows from empty instead of appearing full. */
function TaskRing({ done, total }: { done: number; total: number }) {
  const t = useTranslations("dashboard.tiles.tasks");
  const settings = useFormatSettings();
  const appeared = useAppeared();
  const rate = taskCompletionRate(done, total);
  return (
    <div className="flex items-center gap-4">
      <ProgressRing
        value={appeared ? done : 0}
        max={Math.max(total, 1)}
        label={t("ring", {
          done: formatNumber(done, {}, settings),
          total: formatNumber(total, {}, settings),
        })}
        size={84}
        tone="teal"
      >
        <span className="flex flex-col items-center gap-0.5 leading-none">
          {rate === null ? (
            <>
              <span aria-hidden className="text-xl font-bold text-ink-muted">
                –
              </span>
              <span className="text-[10px] font-medium tracking-wide text-ink-muted uppercase">
                {t("todayNone")}
              </span>
            </>
          ) : (
            <>
              <span className="text-lg font-bold tabular-nums text-ink">
                <AnimatedNumber value={rate} format={{ style: "percent" }} />
              </span>
              <span className="text-[11px] font-medium tabular-nums text-ink-soft">
                <AnimatedNumber value={done} />
                <span className="text-ink-muted"> / </span>
                <AnimatedNumber value={total} />
              </span>
            </>
          )}
        </span>
      </ProgressRing>
      <p className="min-w-0 text-sm text-ink-soft">
        {total === 0
          ? t("none")
          : done === total
            ? t("allDone")
            : t("left", {
                count: total - done,
                formatted: formatNumber(total - done, {}, settings),
              })}
      </p>
    </div>
  );
}

export function TasksTile({ onOpen }: TileProps) {
  const t = useTranslations("dashboard.tiles.tasks");
  const tasks = useTodayTasks();

  return (
    <DashboardTile
      label={t("label")}
      icon={<ListChecksIcon aria-hidden />}
      tone="teal"
      layoutId={tileLayoutId("tasks")}
      onOpen={onOpen}
    >
      {tasks.isError ? (
        <TileError />
      ) : tasks.data ? (
        <TaskRing
          done={tasks.data.done.length}
          total={tasks.data.done.length + tasks.data.openTotal}
        />
      ) : (
        <Skeleton className="size-21 rounded-full" />
      )}
    </DashboardTile>
  );
}

export function WinRateTile({ onOpen }: TileProps) {
  const t = useTranslations("dashboard.tiles.winRate");
  const settings = useFormatSettings();
  const closed = useClosedDeals();

  const now = new Date();
  const result = closed.data
    ? winRate(closed.data, now.getTime() - WIN_RATE_DAYS * 86_400_000)
    : null;
  const series = closed.data ? winRateSeries(closed.data, now) : [];
  const drawn = series.filter((value) => value !== null).length;

  return (
    <DashboardTile
      label={t("label")}
      icon={<TargetIcon aria-hidden />}
      tone="gold"
      layoutId={tileLayoutId("winRate")}
      onOpen={onOpen}
    >
      {closed.isError ? (
        <TileError />
      ) : result ? (
        result.rate === null ? (
          <>
            <TileNumber className="text-ink-muted">
              <span aria-hidden>–</span>
              <span className="sr-only">{t("noData")}</span>
            </TileNumber>
            <p className="text-sm text-ink-muted">
              {t("empty", { days: formatNumber(WIN_RATE_DAYS, {}, settings) })}
            </p>
          </>
        ) : (
          <>
            <TileNumber>
              <AnimatedNumber value={result.rate} format={{ style: "percent" }} />
            </TileNumber>
            <p className="text-sm text-ink-soft">
              {t("hint", {
                won: formatNumber(result.won, {}, settings),
                closed: formatNumber(result.won + result.lost, {}, settings),
                days: formatNumber(WIN_RATE_DAYS, {}, settings),
              })}
            </p>
            {drawn > 1 && (
              <Sparkline
                values={series}
                tone="gold"
                label={t("trend", { days: formatNumber(WIN_RATE_DAYS, {}, settings) })}
              />
            )}
          </>
        )
      ) : (
        <>
          <NumberSkeleton />
          <Skeleton className="h-5 w-3/4" />
        </>
      )}
    </DashboardTile>
  );
}

export function ActiveDealsTile({ onOpen }: TileProps) {
  const t = useTranslations("dashboard.tiles.activeDeals");
  const settings = useFormatSettings();
  const count = useActiveDealCount();
  const stalled = useStalledDeals();

  return (
    <DashboardTile
      label={t("label")}
      icon={<HandshakeIcon aria-hidden />}
      tone="violet"
      layoutId={tileLayoutId("activeDeals")}
      onOpen={onOpen}
    >
      {count.isError ? (
        <TileError />
      ) : count.data !== undefined ? (
        <>
          <TileNumber>
            <AnimatedNumber value={count.data} />
          </TileNumber>
          <p className="text-sm text-ink-soft">
            {stalled.data && stalled.data.total > 0
              ? t("stalled", {
                  count: stalled.data.total,
                  formatted: formatNumber(stalled.data.total, {}, settings),
                })
              : t("hint")}
          </p>
        </>
      ) : (
        <>
          <NumberSkeleton />
          <Skeleton className="h-5 w-1/2" />
        </>
      )}
    </DashboardTile>
  );
}

export function NewContactsTile({ onOpen }: TileProps) {
  const t = useTranslations("dashboard.tiles.newContacts");
  const count = useNewContactCount();

  return (
    <DashboardTile
      label={t("label")}
      icon={<UserPlusIcon aria-hidden />}
      tone="teal"
      layoutId={tileLayoutId("newContacts")}
      onOpen={onOpen}
    >
      {count.isError ? (
        <TileError />
      ) : count.data !== undefined ? (
        <>
          <TileNumber>
            <AnimatedNumber value={count.data} />
          </TileNumber>
          <p className="text-sm text-ink-soft">{t("hint")}</p>
        </>
      ) : (
        <>
          <NumberSkeleton />
          <Skeleton className="h-5 w-1/2" />
        </>
      )}
    </DashboardTile>
  );
}

/** Seconds spent finding clients this week, day-clipped in the user's zone by the database. */
export function useWeekProspecting() {
  const settings = useFormatSettings();
  const { today } = useToday();
  const range = weekRange({ kind: "week", offset: 0 }, today, settings.weekStartsOn);
  const query = useDailySeconds(range);
  return { query, range, today };
}

export function ProspectingTile({ onOpen }: TileProps) {
  const t = useTranslations("dashboard.tiles.prospecting");
  const { query, range, today } = useWeekProspecting();
  const total = query.data ? summarize(range, query.data, today).total : 0;
  const { hours, minutes } = splitDuration(total);

  return (
    <DashboardTile
      label={t("label")}
      icon={<TimerIcon aria-hidden />}
      tone="violet"
      layoutId={tileLayoutId("prospecting")}
      onOpen={onOpen}
    >
      {query.isError ? (
        <TileError />
      ) : query.data ? (
        <>
          <TileNumber className="flex items-baseline gap-1.5">
            {hours > 0 && (
              <>
                <AnimatedNumber value={hours} />
                <span className="text-[0.5em] font-semibold text-ink-soft">{t("hoursUnit")}</span>
              </>
            )}
            <AnimatedNumber value={minutes} />
            <span className="text-[0.5em] font-semibold text-ink-soft">{t("minutesUnit")}</span>
          </TileNumber>
          <p className="text-sm text-ink-soft">{t("hint")}</p>
        </>
      ) : (
        <>
          <NumberSkeleton />
          <Skeleton className="h-5 w-1/2" />
        </>
      )}
    </DashboardTile>
  );
}
