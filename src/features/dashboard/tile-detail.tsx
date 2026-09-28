"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDownIcon, CircleCheckIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { buttonVariants, Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { SidePanel } from "@/components/ui/side-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { summarize, toBars } from "@/features/cold-calling/stats-logic";
import { DailyBarChart } from "@/features/cold-calling/daily-bar-chart";
import { contactName } from "@/features/contacts/types";
import { periodRange as monthRange } from "@/features/finance/finance-logic";
import { useTotals } from "@/features/finance/queries";
import { categoryIcon } from "@/features/finance/types";
import { useStages } from "@/features/pipeline/queries";
import { sortStages } from "@/features/pipeline/board-logic";
import { stageTone } from "@/features/pipeline/types";
import { toneFill } from "@/components/ui/tone";
import {
  formatCalendarDate,
  formatCurrency,
  formatDate,
  formatNumber,
  splitDuration,
} from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { compareToPrevious, winRate, winRateSeries, WIN_RATE_DAYS } from "./dashboard-logic";
import { Trend } from "./dashboard-tile";
import {
  useActiveDealCount,
  useActiveDealsByStage,
  useClosedDeals,
  useMeetingSurveys,
  useNewContactCount,
  useNewContacts,
  useRecentIncome,
  useToday,
  useTodayTasks,
  type MeetingSurvey,
} from "./queries";
import { Sparkline } from "./sparkline";
import { SurveyAnswerList } from "./survey-answers";
import { useWeekProspecting, type TileKey } from "./tiles";

type Props = { tile: TileKey | null; onClose: () => void };

/** The detail of a tile: a side panel on larger screens, a bottom sheet on phones. */
export function TileDetail({ tile, onClose }: Props) {
  const t = useTranslations("dashboard.tiles");
  // Keep the last tile on screen while the panel slides out.
  const [shown, setShown] = useState<TileKey | null>(tile);
  if (tile && tile !== shown) setShown(tile);
  const current = tile ?? shown;

  return (
    <SidePanel
      open={tile !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={current ? t(`${current}.label`) : ""}
      closeLabel={t("close")}
    >
      {current === "income" && <IncomeDetail />}
      {current === "tasks" && <TasksDetail />}
      {current === "winRate" && <WinRateDetail />}
      {current === "activeDeals" && <ActiveDealsDetail />}
      {current === "newContacts" && <NewContactsDetail />}
      {current === "prospecting" && <ProspectingDetail />}
    </SidePanel>
  );
}

function OpenLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant: "outline" }), "self-start")}>
      {children}
    </Link>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="micro-label">{children}</h3>;
}

function Body({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>;
}

function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function Failed() {
  const t = useTranslations("dashboard.tiles");
  return <FormAlert>{t("loadFailed")}</FormAlert>;
}

// ---------------------------------------------------------------------------

function IncomeDetail() {
  const t = useTranslations("dashboard.detail.income");
  const tCategory = useTranslations("finance.categories");
  const settings = useFormatSettings();
  const { today } = useToday();
  const current = useTotals(monthRange("thisMonth", today), null);
  const previous = useTotals(monthRange("lastMonth", today), null);
  const recent = useRecentIncome(true);
  const money = (value: number) =>
    formatCurrency(value, undefined, settings, Number.isInteger(value) ? 0 : 2);

  if (current.isError || previous.isError) return <Failed />;
  if (!current.data || !previous.data) return <Loading />;
  const change = compareToPrevious(current.data.income, previous.data.income);

  return (
    <Body>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-xl border border-line p-3">
          <span className="micro-label">{t("thisMonth")}</span>
          <span className="stat-number text-xl text-green">{money(current.data.income)}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-line p-3">
          <span className="micro-label">{t("lastMonth")}</span>
          <span className="stat-number text-xl text-ink">{money(previous.data.income)}</span>
        </div>
      </div>
      <Trend direction={change.direction}>
        {change.direction === "same"
          ? t("same")
          : t(change.direction, { amount: money(change.difference) })}
      </Trend>

      <div className="flex flex-col gap-2">
        <Heading>{t("recent")}</Heading>
        {recent.isError ? (
          <Failed />
        ) : !recent.data ? (
          <Skeleton className="h-24 w-full" />
        ) : recent.data.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("noIncome")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {recent.data.map((row) => {
              const Icon = categoryIcon(row.category);
              return (
                <li key={row.id} className="flex min-h-11 items-center gap-3 py-2">
                  <Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      {row.description || (row.category ? tCategory(row.category) : t("untitled"))}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {formatCalendarDate(row.occurred_on, settings)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-green tabular-nums">
                    {formatCurrency(
                      row.amount,
                      row.currency,
                      settings,
                      Number.isInteger(row.amount) ? 0 : 2,
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <OpenLink href="/finance">{t("open")}</OpenLink>
    </Body>
  );
}

// ---------------------------------------------------------------------------

function TasksDetail() {
  const t = useTranslations("dashboard.detail.tasks");
  const settings = useFormatSettings();
  const { today } = useToday();
  const tasks = useTodayTasks();

  if (tasks.isError) return <Failed />;
  if (!tasks.data) return <Loading />;
  const { done, open, openTotal } = tasks.data;

  return (
    <Body>
      <p className="text-sm text-ink-soft">
        {t("summary", {
          done: formatNumber(done.length, {}, settings),
          total: formatNumber(done.length + openTotal, {}, settings),
        })}
      </p>
      <div className="flex flex-col gap-2">
        <Heading>{t("stillToDo")}</Heading>
        {open.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("nothingLeft")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {open.map((task) => (
              <li key={task.id} className="flex min-h-11 items-center gap-3 py-2">
                <Link
                  href={`/milestones/${task.milestone_id}`}
                  className="min-w-0 flex-1 text-sm text-ink outline-none hover:text-violet focus-visible:ring-3 focus-visible:ring-violet/40"
                >
                  <span className="block truncate">{task.title}</span>
                  {task.due_date && (
                    <span
                      className={cn(
                        "block text-xs",
                        task.due_date < today ? "text-pink" : "text-ink-muted",
                      )}
                    >
                      {formatCalendarDate(task.due_date, settings)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Heading>{t("doneToday")}</Heading>
        {done.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("nothingDone")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {done.map((task) => (
              <li key={task.id} className="flex min-h-11 items-center gap-3 py-2 text-sm">
                <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-teal" />
                <span className="min-w-0 flex-1 truncate text-ink-soft">{task.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <OpenLink href="/milestones">{t("open")}</OpenLink>
    </Body>
  );
}

// ---------------------------------------------------------------------------

function WinRateDetail() {
  const t = useTranslations("dashboard.detail.winRate");
  const settings = useFormatSettings();
  const closed = useClosedDeals();
  const surveys = useMeetingSurveys(true);

  if (closed.isError) return <Failed />;
  const now = new Date();
  const result = closed.data
    ? winRate(closed.data, now.getTime() - WIN_RATE_DAYS * 86_400_000)
    : null;
  const series = closed.data ? winRateSeries(closed.data, now) : [];

  return (
    <Body>
      {!result ? (
        <Loading />
      ) : result.rate === null ? (
        <p className="text-sm text-ink-muted">
          {t("empty", { days: formatNumber(WIN_RATE_DAYS, {}, settings) })}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="stat-number text-4xl text-ink">
            <AnimatedNumber value={result.rate} format={{ style: "percent" }} />
          </div>
          <p className="text-sm text-ink-soft">
            {t("counts", {
              won: formatNumber(result.won, {}, settings),
              lost: formatNumber(result.lost, {}, settings),
              days: formatNumber(WIN_RATE_DAYS, {}, settings),
            })}
          </p>
          {series.filter((value) => value !== null).length > 1 && (
            <div className="flex flex-col gap-1">
              <Sparkline
                values={series}
                tone="gold"
                label={t("trend", { days: formatNumber(WIN_RATE_DAYS, {}, settings) })}
                className="h-16"
              />
              <div className="flex justify-between text-xs text-ink-muted">
                <span>{t("daysAgo", { days: formatNumber(WIN_RATE_DAYS, {}, settings) })}</span>
                <span>{t("now")}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Heading>{t("surveys")}</Heading>
        {surveys.isError ? (
          <Failed />
        ) : !surveys.data ? (
          <Skeleton className="h-16 w-full" />
        ) : surveys.data.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("noSurveys")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {surveys.data.map((survey) => (
              <SurveyItem key={survey.id} survey={survey} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-line p-3">
        <Button
          type="button"
          variant="outline"
          disabled
          aria-describedby="ai-analysis-note"
          className="self-start"
        >
          <SparklesIcon aria-hidden data-icon="inline-start" />
          {t("aiAnalysis")}
        </Button>
        <p id="ai-analysis-note" className="text-xs text-ink-muted">
          {t("aiSoon")}
        </p>
      </div>
      <OpenLink href="/pipeline">{t("open")}</OpenLink>
    </Body>
  );
}

function SurveyItem({ survey }: { survey: MeetingSurvey }) {
  const t = useTranslations("dashboard.detail.winRate");
  const settings = useFormatSettings();
  const [expanded, setExpanded] = useState(false);
  const panelId = `survey-${survey.id}`;

  return (
    <li className="rounded-xl border border-line">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-violet/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {survey.dealTitle ?? t("deletedDeal")}
          </span>
          <span className="block text-xs text-ink-muted">
            {formatDate(new Date(survey.created_at), settings)}
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-ink-muted transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && (
        <div id={panelId} className="border-t border-line px-3 py-3">
          <SurveyAnswerList answers={survey.answers} />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------

function ActiveDealsDetail() {
  const t = useTranslations("dashboard.detail.activeDeals");
  const settings = useFormatSettings();
  const total = useActiveDealCount();
  const stagesQuery = useStages();
  const byStage = useActiveDealsByStage(true);

  if (total.isError || stagesQuery.isError || byStage.isError) return <Failed />;
  if (total.data === undefined || !stagesQuery.data || !byStage.data) return <Loading />;
  const stages = sortStages(stagesQuery.data).filter((stage) => !stage.is_won && !stage.is_lost);

  return (
    <Body>
      <div className="stat-number text-4xl text-ink">
        <AnimatedNumber value={total.data} />
      </div>
      {stages.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {stages.map((stage) => (
            <li key={stage.id} className="flex min-h-11 items-center gap-3 py-2">
              <span
                aria-hidden
                className={cn("size-2.5 shrink-0 rounded-full", toneFill[stageTone(stage.color)])}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{stage.name}</span>
              <span className="text-sm font-semibold text-ink tabular-nums">
                {formatNumber(byStage.data.get(stage.id) ?? 0, {}, settings)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <OpenLink href="/pipeline">{t("open")}</OpenLink>
    </Body>
  );
}

// ---------------------------------------------------------------------------

function NewContactsDetail() {
  const t = useTranslations("dashboard.detail.newContacts");
  const settings = useFormatSettings();
  const count = useNewContactCount();
  const latest = useNewContacts(true);

  if (count.isError || latest.isError) return <Failed />;
  if (count.data === undefined || !latest.data) return <Loading />;

  return (
    <Body>
      <div className="stat-number text-4xl text-ink">
        <AnimatedNumber value={count.data} />
      </div>
      {latest.data.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("none")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Heading>{t("latest")}</Heading>
          <ul className="flex flex-col divide-y divide-line">
            {latest.data.map((contact) => (
              <li key={contact.id} className="min-h-11">
                <Link
                  href={`/contacts/${contact.id}`}
                  className="flex min-h-11 items-center gap-3 py-2 outline-none hover:text-violet focus-visible:ring-3 focus-visible:ring-violet/40"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {contactName(contact) || t("unnamed")}
                  </span>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {formatDate(new Date(contact.created_at), settings)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <OpenLink href="/contacts">{t("open")}</OpenLink>
    </Body>
  );
}

// ---------------------------------------------------------------------------

function ProspectingDetail() {
  const t = useTranslations("dashboard.detail.prospecting");
  const tTile = useTranslations("dashboard.tiles.prospecting");
  const settings = useFormatSettings();
  const { query, range, today } = useWeekProspecting();

  if (query.isError) return <Failed />;
  if (!query.data) return <Loading />;

  function duration(total: number) {
    const { hours, minutes } = splitDuration(total);
    return hours > 0
      ? t("hoursMinutes", {
          hours: formatNumber(hours, {}, settings),
          minutes: String(minutes).padStart(2, "0"),
        })
      : t("minutes", { minutes: formatNumber(minutes, {}, settings) });
  }

  const summary = summarize(range, query.data, today);
  const bars = toBars("week", range, query.data, today);

  return (
    <Body>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-xl border border-line p-3">
          <span className="micro-label">{t("total")}</span>
          <span className="stat-number text-xl text-ink">{duration(summary.total)}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-line p-3">
          <span className="micro-label">{t("average")}</span>
          <span className="stat-number text-xl text-ink">{duration(summary.average)}</span>
        </div>
      </div>
      <DailyBarChart
        title={tTile("label")}
        bars={bars}
        kind="week"
        color="violet"
        formatValue={duration}
        plot={(value) => Math.round(value / 60)}
        formatTick={(value) => formatNumber(value, {}, settings)}
      />
      <p className="text-xs text-ink-muted">{t("axisMinutes")}</p>
      <OpenLink href="/cold-calling">{t("open")}</OpenLink>
    </Body>
  );
}
