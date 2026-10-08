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
import { AdminCard, GridSkeleton, TilesSkeleton } from "@/features/admin/ui/blocks";
import { BreakdownList, DataTable } from "@/features/admin/ui/data-blocks";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "@/features/admin/format-metric";
import { TileGrid } from "@/features/admin/ui/metric-tile";
import { formatDateTime } from "@/lib/format";
import { viewKey } from "@/features/admin/view-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.health");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminHealthPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "health");
  const q = adminQuery(await searchParams);
  const key = viewKey(q.view, q.range);

  return (
    <>
      <AdminPageHeader section="health" q={q} />
      <Suspense key={`tiles:${key}`} fallback={<TilesSkeleton count={2} />}>
        <Tiles q={q} />
      </Suspense>
      <Suspense key={`chart:${key}`} fallback={<GridSkeleton count={1} />}>
        <Chart q={q} />
      </Suspense>
      <Suspense key={`latency:${key}`} fallback={<GridSkeleton count={2} height={220} />}>
        <Latency q={q} />
      </Suspense>
      <Suspense key={`breakdowns:${key}`} fallback={<GridSkeleton count={2} height={180} />}>
        <Breakdowns q={q} />
      </Suspense>
      <Suspense fallback={<GridSkeleton count={1} height={240} />}>
        <Cron q={q} />
      </Suspense>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("health tiles", () => healthTiles(q));
  return <Show loaded={loaded}>{(tiles) => <TileGrid tiles={tiles} />}</Show>;
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
      render: (row: { n: number | null }) => String(row.n ?? 0),
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
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <AdminCard title={tItems("route_latency.name")} description={tItems("route_latency.description")}>
        <Show loaded={route}>{(rows) => <DataTable id="health.route_latency" rows={rows} columns={columns(t("columns.route"))} />}</Show>
      </AdminCard>
      <AdminCard title={tItems("page_load.name")} description={tItems("page_load.description")}>
        <Show loaded={page}>{(rows) => <DataTable id="health.page_load" rows={rows} columns={columns(t("columns.page"))} />}</Show>
      </AdminCard>
    </div>
  );
}

async function Breakdowns({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("health breakdowns", () => healthBreakdowns(q)),
    getTranslations("metrics.items"),
  ]);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Show loaded={loaded}>
        {(blocks) =>
          blocks.map((block) => (
            <AdminCard key={block.key} title={t(`${block.key}.name`)} description={t(`${block.key}.description`)}>
              <BreakdownList data={block} />
            </AdminCard>
          ))
        }
      </Show>
    </div>
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
            rows={rows}
            columns={[
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
                render: (row) => String(row.runs7d ?? 0),
                csv: (row) => row.runs7d,
              },
              {
                key: "failures_7d",
                label: t("columns.failures7d"),
                align: "right",
                render: (row) => String(row.failures7d ?? 0),
                csv: (row) => row.failures7d,
              },
            ]}
          />
        )}
      </Show>
    </AdminCard>
  );
}
