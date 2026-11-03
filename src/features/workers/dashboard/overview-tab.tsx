"use client";

import { useMemo, useState } from "react";
import { AlarmClockIcon, BriefcaseIcon, ListTodoIcon, TrophyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormAlert } from "@/components/ui/form-alert";
import { GlowCard } from "@/components/ui/glow-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { useCan } from "@/features/account/workspace-queries";
import { useStages } from "@/features/pipeline/queries";
import { formatCurrency, formatNumber, todayIsoDate } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { ChartBars } from "./chart-bars";
import { HorizonPicker } from "./chart-horizon";
import {
  bucketDeals,
  bucketTasks,
  bucketUnit,
  dashboardStats,
  horizonRange,
  type Horizon,
} from "./chart-logic";
import type { DashboardWorker } from "./types";
import { toChartDeals, useWorkerDeals, useWorkerTasks } from "./work-queries";

/**
 * The person at a glance: four numbers for the chosen horizon, the tasks they
 * finished over time (in time, late, missed) and the deals in their care
 * (won, lost, new), plus the value won when the viewer may see amounts.
 */
export function OverviewTab({ worker }: { worker: DashboardWorker }) {
  const t = useTranslations("workers.dashboard.overview");
  const settings = useFormatSettings();
  const seeAmounts = useCan("pipeline", "see_amounts");
  const [now] = useState(() => new Date());
  const today = todayIsoDate(settings, now);
  const [horizon, setHorizon] = useState<Horizon>({ kind: "month" });
  const range = useMemo(() => horizonRange(horizon, today, settings), [horizon, today, settings]);
  const unit = bucketUnit(horizon, range);

  const tasks = useWorkerTasks(worker.id, worker.userId, range);
  const deals = useWorkerDeals(worker.id, worker.userId);
  const stages = useStages();

  const chartDeals = useMemo(
    () => toChartDeals(deals.data ?? [], stages.data ?? []),
    [deals.data, stages.data],
  );
  const stats = useMemo(
    () => dashboardStats(tasks.data ?? [], chartDeals, range, now, settings),
    [tasks.data, chartDeals, range, now, settings],
  );
  const taskRows = useMemo(
    () => bucketTasks(tasks.data ?? [], range, unit, now, settings),
    [tasks.data, range, unit, now, settings],
  );
  const dealRows = useMemo(
    () => bucketDeals(chartDeals, range, unit, settings),
    [chartDeals, range, unit, settings],
  );

  const loading = tasks.isPending || deals.isPending || stages.isPending;
  const failed = tasks.isError || deals.isError || stages.isError;
  const count = (value: number) => formatNumber(value, {}, settings);
  const weekdays = horizon.kind === "week";
  const hasTasks = taskRows.some((row) => row.onTime + row.late + row.missed > 0);
  const hasDeals = dealRows.rows.some((row) => row.won + row.lost + row.opened > 0);
  const hasValue = dealRows.rows.some((row) => row.wonValue > 0);

  return (
    <div className="flex flex-col gap-5">
      <HorizonPicker value={horizon} today={today} onChange={setHorizon} />

      {failed && <FormAlert>{t("loadFailed")}</FormAlert>}
      {!worker.userId && <p className="text-sm text-ink-muted">{t("noAccount")}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t("stats.openTasks")}
          value={stats.openTasks}
          tone="violet"
          icon={<ListTodoIcon />}
        />
        <StatTile
          label={t("stats.overdue")}
          value={stats.overdueTasks}
          tone={stats.overdueTasks > 0 ? "pink" : "green"}
          icon={<AlarmClockIcon />}
        />
        <StatTile
          label={t("stats.openDeals")}
          value={stats.openDeals}
          tone="teal"
          icon={<BriefcaseIcon />}
        />
        <StatTile label={t("stats.won")} value={stats.wonDeals} tone="gold" icon={<TrophyIcon />} />
      </div>

      <GlowCard interactive={false} className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-ink">{t("tasksChart.title")}</h3>
        {loading ? (
          <Skeleton className="h-52 w-full rounded-xl" />
        ) : hasTasks ? (
          <ChartBars
            title={t("tasksChart.title")}
            rows={taskRows}
            unit={unit}
            weekdays={weekdays}
            stacked
            formatValue={count}
            series={[
              { key: "onTime", label: t("tasksChart.onTime"), color: "green" },
              { key: "late", label: t("tasksChart.late"), color: "orange" },
              { key: "missed", label: t("tasksChart.missed"), color: "pink" },
            ]}
          />
        ) : (
          <p className="py-8 text-center text-sm text-ink-muted">{t("tasksChart.empty")}</p>
        )}
      </GlowCard>

      <GlowCard interactive={false} className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-ink">{t("dealsChart.title")}</h3>
        {loading ? (
          <Skeleton className="h-52 w-full rounded-xl" />
        ) : hasDeals ? (
          <ChartBars
            title={t("dealsChart.title")}
            rows={dealRows.rows}
            unit={unit}
            weekdays={weekdays}
            formatValue={count}
            series={[
              { key: "won", label: t("dealsChart.won"), color: "green" },
              { key: "lost", label: t("dealsChart.lost"), color: "pink" },
              { key: "opened", label: t("dealsChart.opened"), color: "violet" },
            ]}
          />
        ) : (
          <p className="py-8 text-center text-sm text-ink-muted">{t("dealsChart.empty")}</p>
        )}
      </GlowCard>

      {seeAmounts && !loading && hasDeals && (
        <GlowCard interactive={false} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">
            {t("valueChart.title", { currency: settings.currency })}
          </h3>
          {hasValue ? (
            <ChartBars
              title={t("valueChart.title", { currency: settings.currency })}
              rows={dealRows.rows}
              unit={unit}
              weekdays={weekdays}
              formatValue={(value) => formatCurrency(value, settings.currency, settings)}
              axisWidth={84}
              series={[{ key: "wonValue", label: t("valueChart.series"), color: "green" }]}
            />
          ) : (
            <p className="py-6 text-center text-sm text-ink-muted">{t("valueChart.empty")}</p>
          )}
          <p className="text-xs text-ink-muted">
            {dealRows.otherCurrencyWon > 0
              ? t("valueChart.otherCurrencies", {
                  count: dealRows.otherCurrencyWon,
                  currency: settings.currency,
                })
              : t("valueChart.onlyCurrency", { currency: settings.currency })}
          </p>
        </GlowCard>
      )}
    </div>
  );
}
