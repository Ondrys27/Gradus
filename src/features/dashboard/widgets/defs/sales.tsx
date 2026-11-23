"use client";

import { CalendarCheckIcon, KanbanSquareIcon, UserPlusIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { toneFill } from "@/components/ui/tone";
import { contactName } from "@/features/contacts/types";
import { summarize, toBars } from "@/features/cold-calling/stats-logic";
import { useTimerReading } from "@/features/cold-calling/timer-queries";
import {
  useClosedDeals,
  useNewContactCount,
  useNewContacts,
  useWeekProspecting,
} from "@/features/dashboard/queries";
import { winRate, winRateSeries, WIN_RATE_DAYS } from "@/features/dashboard/dashboard-logic";
import { Sparkline } from "@/features/dashboard/sparkline";
import {
  NewContactsDetail,
  ProspectingDetail,
  WinRateDetail,
} from "@/features/dashboard/tile-detail";
import { sortStages, sumByCurrency } from "@/features/pipeline/board-logic";
import { PipelineHealthTiles, pipelineTileHref } from "@/features/pipeline/dashboard-health";
import { HEALTH_TILES } from "@/features/pipeline/health";
import { usePipelineHealth } from "@/features/pipeline/use-pipeline-health";
import { useDeals, useStages } from "@/features/pipeline/queries";
import { stageTone } from "@/features/pipeline/types";
import { useWaitingBookings } from "@/features/scheduler/booking-queries";
import { bookingAppPath } from "@/features/scheduler/booking/paths";
import { useBookings } from "@/features/scheduler/queries";
import { formatCurrency, formatDateTime, formatNumber, splitDuration } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import {
  BigValue,
  combine,
  defineWidget,
  DetailHeading,
  Empty,
  Hint,
  READY,
  Row,
  RowList,
  type WidgetQuery,
  type WidgetSettings,
} from "../kit";

// ---------------------------------------------------------------------------
// Pipeline: open deals by stage, as value (with the right to see amounts) or count
// ---------------------------------------------------------------------------

type StageSum = {
  id: string;
  name: string;
  tone: ReturnType<typeof stageTone>;
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

function PipelineView({
  size,
  data,
  settings,
}: {
  size: string;
  data: PipelineData;
  settings: WidgetSettings;
}) {
  const t = useTranslations("dashboard.widgets.pipeline");
  const format = useFormatSettings();
  const byValue = settings.measure !== "count" && data.totals.length > 0;
  const main = data.totals[0];
  if (data.count === 0) {
    return (
      <Empty
        icon={KanbanSquareIcon}
        tone="violet"
        title={t("emptyTitle")}
        hint={size === "S" ? undefined : t("emptyHint")}
        action={size === "S" ? undefined : { label: t("newDeal"), href: "/app/pipeline?new=deal" }}
        compact={size !== "L" && size !== "XL"}
      />
    );
  }
  const amountOf = (stage: StageSum) => (byValue ? stageValue(stage, main?.currency) : stage.count);
  const max = Math.max(1, ...data.stages.map(amountOf));
  const others = data.totals.length - 1;
  const headline = (
    <BigValue>
      {byValue && main ? (
        formatCurrency(main.total, main.currency, format)
      ) : (
        <AnimatedNumber value={data.count} />
      )}
    </BigValue>
  );
  const sub = byValue
    ? others > 0
      ? t("valueOthers", { count: data.count, others })
      : t("valueHint", { count: data.count })
    : t("countHint", { count: data.count });
  if (size === "S") {
    return (
      <div className="flex flex-col gap-1.5">
        {headline}
        <Hint>{sub}</Hint>
      </div>
    );
  }
  if (size === "M") {
    const total = data.stages.reduce((sum, stage) => sum + amountOf(stage), 0) || 1;
    return (
      <div className="flex flex-col gap-2">
        {headline}
        <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
          {data.stages.map((stage) => (
            <span
              key={stage.id}
              className={cn("h-full", toneFill[stage.tone])}
              style={{ width: `${(amountOf(stage) / total) * 100}%` }}
            />
          ))}
        </div>
        <Hint>{sub}</Hint>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        {headline}
        <span className="text-xs text-ink-muted">{sub}</span>
      </div>
      <ul className={cn("grid gap-2", size === "XL" && "@3xl:grid-cols-2 @3xl:gap-x-6")}>
        {data.stages.map((stage) => (
          <li key={stage.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-ink-soft">{stage.name}</span>
              <span className="shrink-0 font-semibold text-ink tabular-nums">
                {byValue && main
                  ? formatCurrency(stageValue(stage, main.currency), main.currency, format)
                  : formatNumber(stage.count, {}, format)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
              <span
                className={cn("block h-full rounded-full", toneFill[stage.tone])}
                style={{ width: `${(amountOf(stage) / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
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
              lead={
                <span className={cn("inline-block size-2.5 rounded-full", toneFill[stage.tone])} />
              }
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

function OnFireCompact() {
  const t = useTranslations("pipeline.health");
  const format = useFormatSettings();
  const { health } = usePipelineHealth();
  if (!health) return null;
  return (
    <ul className="grid grid-cols-3 gap-2">
      {HEALTH_TILES.map((tile) => {
        const count = health[tile].count;
        return (
          <li key={tile}>
            <Link
              href={pipelineTileHref(tile)}
              className="flex flex-col gap-0.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
            >
              <span
                className={cn(
                  "text-2xl font-bold tabular-nums",
                  count === 0 ? "text-green" : count <= 3 ? "text-gold" : "text-pink",
                )}
              >
                {formatNumber(count, {}, format)}
              </span>
              <span className="line-clamp-2 text-xs text-ink-soft">{t(`tiles.${tile}.label`)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export const onFireWidget = defineWidget<true>({
  key: "onFire",
  useData: () => READY,
  View: ({ size }) => (size === "M" ? <OnFireCompact /> : <PipelineHealthTiles />),
  Detail: () => <PipelineHealthTiles />,
});

// ---------------------------------------------------------------------------
// Win rate (the former tile)
// ---------------------------------------------------------------------------

type WinData = ReturnType<typeof winRate> & { series: (number | null)[] };

function useWinRate(): WidgetQuery<WinData> {
  const closed = useClosedDeals();
  return combine([closed], () => {
    const now = new Date();
    return {
      ...winRate(closed.data!, now.getTime() - WIN_RATE_DAYS * 86_400_000),
      series: winRateSeries(closed.data!, now),
    };
  });
}

export const winRateWidget = defineWidget<WinData>({
  key: "winRate",
  useData: useWinRate,
  View: ({ size, data }) => {
    const t = useTranslations("dashboard.tiles.winRate");
    const format = useFormatSettings();
    const days = formatNumber(WIN_RATE_DAYS, {}, format);
    if (data.rate === null) {
      return (
        <div className="flex flex-col gap-1.5">
          <BigValue className="text-ink-muted">
            <span aria-hidden>–</span>
            <span className="sr-only">{t("noData")}</span>
          </BigValue>
          <Hint>{t("empty", { days })}</Hint>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        <BigValue>
          <AnimatedNumber value={data.rate} format={{ style: "percent" }} />
        </BigValue>
        {size !== "S" && (
          <Hint>
            {t("hint", {
              won: formatNumber(data.won, {}, format),
              closed: formatNumber(data.won + data.lost, {}, format),
              days,
            })}
          </Hint>
        )}
        {size !== "S" && data.series.filter((value) => value !== null).length > 1 && (
          <Sparkline values={data.series} tone="gold" label={t("trend", { days })} />
        )}
      </div>
    );
  },
  Detail: () => <WinRateDetail />,
});

// ---------------------------------------------------------------------------
// New contacts this month (the former tile)
// ---------------------------------------------------------------------------

type ContactsData = {
  count: number;
  latest: {
    id: string;
    company_name: string | null;
    first_name: string | null;
    last_name: string | null;
  }[];
};

function useNewContactsData(): WidgetQuery<ContactsData> {
  const count = useNewContactCount();
  const latest = useNewContacts(true);
  return combine([count, latest], () => ({ count: count.data!, latest: latest.data! }));
}

export const newContactsWidget = defineWidget<ContactsData>({
  key: "newContacts",
  useData: useNewContactsData,
  View: ({ size, data }) => {
    const t = useTranslations("dashboard.tiles.newContacts");
    const tw = useTranslations("dashboard.widgets.newContacts");
    return (
      <div className="flex min-h-0 flex-col gap-1.5">
        <BigValue>
          <AnimatedNumber value={data.count} />
        </BigValue>
        <Hint>{t("hint")}</Hint>
        {size === "L" &&
          (data.latest.length === 0 ? (
            <Empty
              icon={UserPlusIcon}
              title={tw("emptyTitle")}
              action={{ label: tw("add"), href: "/app/kontakty?new=contact" }}
              compact
            />
          ) : (
            <RowList>
              {data.latest.slice(0, 4).map((contact) => (
                <Row key={contact.id} href={`/app/kontakty/${contact.id}`}>
                  {contactName(contact) || tw("unnamed")}
                </Row>
              ))}
            </RowList>
          ))}
      </div>
    );
  },
  Detail: () => <NewContactsDetail />,
});

// ---------------------------------------------------------------------------
// Cold calling: time spent finding clients today and this week
// ---------------------------------------------------------------------------

type CallingData = {
  today: number;
  week: number;
  bars: { key: string; value: number; current: boolean }[];
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

function Duration({ seconds }: { seconds: number }) {
  const t = useTranslations("dashboard.tiles.prospecting");
  const { hours, minutes } = splitDuration(seconds);
  return (
    <span className="flex items-baseline gap-1">
      {hours > 0 && (
        <>
          <AnimatedNumber value={hours} />
          <span className="text-[0.5em] font-semibold text-ink-soft">{t("hoursUnit")}</span>
        </>
      )}
      <AnimatedNumber value={minutes} />
      <span className="text-[0.5em] font-semibold text-ink-soft">{t("minutesUnit")}</span>
    </span>
  );
}

export const coldCallingWidget = defineWidget<CallingData>({
  key: "coldCalling",
  useData: useCalling,
  View: ({ size, data }) => {
    const t = useTranslations("dashboard.widgets.coldCalling");
    const max = Math.max(1, ...data.bars.map((bar) => bar.value));
    return (
      <div className="flex min-h-0 flex-col gap-1.5">
        <BigValue>
          <Duration seconds={data.today} />
        </BigValue>
        <Hint>{t("today")}</Hint>
        {size !== "S" && (
          <p className="text-sm text-ink-soft">
            {t("week")}{" "}
            <span className="font-semibold text-ink">
              <Duration seconds={data.week} />
            </span>
          </p>
        )}
        {size === "L" && (
          <div className="mt-auto flex h-20 items-end gap-1.5" aria-hidden>
            {data.bars.map((bar) => (
              <span
                key={bar.key}
                className={cn("flex-1 rounded-t", bar.current ? "bg-violet" : "bg-violet/35")}
                style={{ height: `${Math.max(4, (bar.value / max) * 100)}%` }}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
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

export const bookingsWidget = defineWidget<BookingsData>({
  key: "bookings",
  useData: useBookingsData,
  View: ({ size, data }) => {
    const t = useTranslations("dashboard.widgets.bookings");
    const format = useFormatSettings();
    if (data.upcoming.length === 0) {
      return (
        <Empty
          icon={CalendarCheckIcon}
          tone="teal"
          title={t("emptyTitle")}
          hint={size === "S" ? undefined : t("emptyHint")}
          action={size === "S" ? undefined : { label: t("share"), href: "/app/planovac" }}
          compact={size !== "L"}
        />
      );
    }
    return (
      <div className="flex min-h-0 flex-col gap-1.5">
        <BigValue>
          <AnimatedNumber value={data.upcoming.length} />
        </BigValue>
        <Hint>
          {data.pending > 0
            ? t("pending", { count: data.pending })
            : t("upcoming", { count: data.upcoming.length })}
        </Hint>
        {size !== "S" && (
          <RowList>
            {data.upcoming.slice(0, size === "L" ? 4 : 1).map((booking) => (
              <Row
                key={booking.id}
                href={bookingAppPath(booking.id)}
                lead={formatDateTime(new Date(booking.starts_at), format)}
              >
                {booking.guest_name ?? t("guest")}
              </Row>
            ))}
          </RowList>
        )}
      </div>
    );
  },
  Detail: ({ data }) => {
    const t = useTranslations("dashboard.widgets.bookings");
    const format = useFormatSettings();
    if (data.upcoming.length === 0) {
      return (
        <Empty icon={CalendarCheckIcon} tone="teal" title={t("emptyTitle")} hint={t("emptyHint")} />
      );
    }
    return (
      <RowList>
        {data.upcoming.map((booking) => (
          <Row
            key={booking.id}
            href={bookingAppPath(booking.id)}
            lead={formatDateTime(new Date(booking.starts_at), format)}
            trail={
              booking.status === "pending" ? (
                <span className="text-gold">{t("toApprove")}</span>
              ) : undefined
            }
          >
            {booking.guest_name ?? t("guest")}
          </Row>
        ))}
      </RowList>
    );
  },
});
