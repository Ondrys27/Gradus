import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import {
  cronRuns,
  healthBreakdowns,
  healthChart,
  healthTiles,
  pageLoad,
  routeLatency,
} from "@/features/admin/server/page-data";
import { AdminChart } from "@/features/admin/ui/admin-chart";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminCard, BlockGrid, CardSkeleton, FiguresSkeleton, GridSkeleton } from "@/features/admin/ui/blocks";
import { buildTable } from "@/features/admin/table";
import { BreakdownList, DataTable } from "@/features/admin/ui/data-blocks";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "@/features/admin/format-metric";
import { Figures } from "@/features/admin/ui/metric-tile";
import { exchangeRateHealth } from "@/features/currency/server/rates";
import { formatDateTime, formatNumber } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.health");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const count = (value: number | null) => formatNumber(value ?? 0, {}, ADMIN_FORMAT_SETTINGS);

export default async function AdminHealthPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "health");
  const q = adminQuery(await searchParams, "health");

  return (
    <>
      <AdminPageHeader section="health" q={q} />
      <div className="flex flex-col gap-4">
        <Suspense fallback={<FiguresSkeleton count={2} />}>
          <Tiles q={q} />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <Chart q={q} />
        </Suspense>
        <Suspense fallback={<GridSkeleton count={2} height={220} />}>
          <Latency q={q} />
        </Suspense>
        <Suspense fallback={<GridSkeleton count={2} height={180} />}>
          <Breakdowns q={q} />
        </Suspense>
        <Suspense fallback={<CardSkeleton height={240} />}>
          <Cron q={q} />
        </Suspense>
        <Suspense fallback={<CardSkeleton height={200} />}>
          <ExchangeRates />
        </Suspense>
      </div>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("health tiles", () => healthTiles(q));
  return <Show loaded={loaded}>{(tiles) => <Figures tiles={tiles} />}</Show>;
}

async function Chart({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("health chart", () => healthChart(q)),
    getTranslations("metrics.items.errors"),
  ]);
  return (
    <AdminCard title={t("name")} description={t("description")}>
      <Show loaded={loaded}>{(chart) => <AdminChart data={chart} title={t("name")} />}</Show>
    </AdminCard>
  );
}

async function Latency({ q }: { q: AdminQuery }) {
  const [route, page, t, tItems, tUnits] = await Promise.all([
    safe("route latency", () => routeLatency(q)),
    safe("page load", () => pageLoad(q)),
    getTranslations("admin.health"),
    getTranslations("metrics.items"),
    getTranslations("admin.units"),
  ]);
  const columns = (nameLabel: string) => [
    { key: "key", label: nameLabel, render: (row: { key: string }) => row.key },
    {
      key: "n",
      label: t("columns.count"),
      align: "right" as const,
      render: (row: { n: number | null }) => count(row.n),
      csv: (row: { n: number | null }) => row.n,
    },
    {
      key: "p50",
      label: t("columns.p50"),
      align: "right" as const,
      render: (row: { p50: number | null }) => formatMetricValue(row.p50, "ms", tUnits),
      csv: (row: { p50: number | null }) => row.p50,
    },
    {
      key: "p95",
      label: t("columns.p95"),
      align: "right" as const,
      render: (row: { p95: number | null }) => formatMetricValue(row.p95, "ms", tUnits),
      csv: (row: { p95: number | null }) => row.p95,
    },
  ];
  return (
    <BlockGrid>
      <AdminCard title={tItems("route_latency.name")} description={tItems("route_latency.description")}>
        <Show loaded={route}>{(rows) => <DataTable id="health.route_latency" table={buildTable(rows, columns(t("columns.route")))} />}</Show>
      </AdminCard>
      <AdminCard title={tItems("page_load.name")} description={tItems("page_load.description")}>
        <Show loaded={page}>{(rows) => <DataTable id="health.page_load" table={buildTable(rows, columns(t("columns.page")))} />}</Show>
      </AdminCard>
    </BlockGrid>
  );
}

async function Breakdowns({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("health breakdowns", () => healthBreakdowns(q)),
    getTranslations("metrics.items"),
  ]);
  return (
    <BlockGrid>
      <Show loaded={loaded}>
        {(blocks) =>
          blocks.map((block) => (
            <AdminCard key={block.key} title={t(`${block.key}.name`)} description={t(`${block.key}.description`)}>
              <BreakdownList data={block} />
            </AdminCard>
          ))
        }
      </Show>
    </BlockGrid>
  );
}

async function Cron({ q }: { q: AdminQuery }) {
  const [loaded, t, tKinds] = await Promise.all([
    safe("cron runs", () => cronRuns(q)),
    getTranslations("admin.health"),
    getTranslations("metrics.items.cron_runs"),
  ]);
  return (
    <AdminCard title={tKinds("name")} description={tKinds("description")}>
      <Show loaded={loaded}>
        {(rows) => (
          <DataTable
            id="health.cron_runs"
            table={buildTable(rows, [
              { key: "job", label: t("columns.job"), render: (row) => row.job },
              {
                key: "last_run_at",
                label: t("columns.lastRun"),
                render: (row) =>
                  row.lastRunAt ? formatDateTime(new Date(row.lastRunAt), ADMIN_FORMAT_SETTINGS) : "–",
                csv: (row) => row.lastRunAt,
              },
              {
                key: "last_ok",
                label: t("columns.lastOk"),
                render: (row) => (row.lastOk === null ? "–" : row.lastOk ? t("ok") : t("failed")),
              },
              {
                key: "runs_7d",
                label: t("columns.runs7d"),
                align: "right",
                render: (row) => count(row.runs7d),
                csv: (row) => row.runs7d,
              },
              {
                key: "failures_7d",
                label: t("columns.failures7d"),
                align: "right",
                render: (row) => count(row.failures7d),
                csv: (row) => row.failures7d,
              },
            ])}
          />
        )}
      </Show>
    </AdminCard>
  );
}

/**
 * Exchange rates (step 24.1): how each source did on its last run. A failed
 * source keeps its last rates; a rate older than 7 days is not used for a
 * price (EUR is shown instead), listed here so the owner sees it.
 */
async function ExchangeRates() {
  const [loaded, t] = await Promise.all([
    safe("exchange rates", () => exchangeRateHealth()),
    getTranslations("admin.health.rates"),
  ]);
  const at = (value: string | null) => (value ? formatDateTime(new Date(value), ADMIN_FORMAT_SETTINGS) : "–");
  return (
    <AdminCard title={t("title")} description={t("description")}>
      <Show loaded={loaded}>
        {(health) => (
          <div className="flex flex-col gap-3" data-testid="health-exchange-rates">
            <DataTable
              id="health.exchange_rates"
              table={buildTable(health.sources, [
                { key: "source", label: t("columns.source"), render: (row) => t(`sources.${row.source}`) },
                {
                  key: "last_success_at",
                  label: t("columns.lastSuccess"),
                  render: (row) => at(row.lastSuccessAt),
                  csv: (row) => row.lastSuccessAt,
                },
                {
                  key: "last_attempt_at",
                  label: t("columns.lastAttempt"),
                  render: (row) => at(row.lastAttemptAt),
                  csv: (row) => row.lastAttemptAt,
                },
                {
                  key: "state",
                  label: t("columns.state"),
                  render: (row) =>
                    row.lastAttemptAt === null
                      ? t("never")
                      : row.lastError
                        ? t("failed", { error: row.lastError })
                        : t("ok"),
                  csv: (row) => row.lastError ?? (row.lastAttemptAt ? "ok" : ""),
                },
                {
                  key: "rates",
                  label: t("columns.rates"),
                  align: "right",
                  render: (row) => count(row.rates),
                  csv: (row) => row.rates,
                },
              ])}
            />
            <p className={health.stale.length ? "text-sm text-gold" : "text-sm text-ink-soft"}>
              {health.stale.length
                ? t("stale", {
                    count: health.stale.length,
                    shown: count(health.stale.length),
                    codes: health.stale.join(", "),
                  })
                : t("fresh", { count: health.currencies, shown: count(health.currencies) })}
            </p>
          </div>
        )}
      </Show>
    </AdminCard>
  );
}
