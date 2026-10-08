import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import {
  COHORT_WEEKS,
  retentionActiveDays,
  retentionBreakdowns,
  retentionCharts,
  retentionCohorts,
  retentionHeatmap,
  retentionSessions,
  retentionTiles,
} from "@/features/admin/server/page-data";
import { AdminChart } from "@/features/admin/ui/admin-chart";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminCard, CardSkeleton, GridSkeleton, TilesSkeleton } from "@/features/admin/ui/blocks";
import {
  BreakdownList,
  CohortTable,
  FieldsGrid,
  UsageHeatmap,
} from "@/features/admin/ui/data-blocks";
import { TileGrid } from "@/features/admin/ui/metric-tile";
import { viewKey } from "@/features/admin/view-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.retention");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminRetentionPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "retention");
  const q = adminQuery(await searchParams);
  const key = viewKey(q.view, q.range);

  return (
    <>
      <AdminPageHeader section="retention" q={q} />
      <Suspense key={`tiles:${key}`} fallback={<TilesSkeleton count={7} />}>
        <Tiles q={q} />
      </Suspense>
      <Suspense key={`cohorts:${key}`} fallback={<GridSkeleton count={2} height={300} />}>
        <Cohorts q={q} />
      </Suspense>
      <Suspense key={`heatmap:${key}`} fallback={<CardSkeleton height={200} />}>
        <Heatmap q={q} />
      </Suspense>
      <Suspense key={`charts:${key}`} fallback={<GridSkeleton count={2} />}>
        <Charts q={q} />
      </Suspense>
      <Suspense key={`more:${key}`} fallback={<GridSkeleton count={3} height={160} />}>
        <More q={q} />
      </Suspense>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("retention tiles", () => retentionTiles(q));
  return <Show loaded={loaded}>{(tiles) => <TileGrid tiles={tiles} />}</Show>;
}

async function Cohorts({ q }: { q: AdminQuery }) {
  const [loaded, t, tItems] = await Promise.all([
    safe("retention cohorts", () => retentionCohorts(q)),
    getTranslations("admin.retention"),
    getTranslations("metrics.items.cohorts"),
  ]);
  return (
    <Show loaded={loaded}>
      {({ cohorts, curves }) => (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          <AdminCard title={tItems("name")} description={tItems("description")}>
            <CohortTable cohorts={cohorts} weeks={COHORT_WEEKS} />
          </AdminCard>
          <AdminCard title={t("curvesTitle")} description={t("curvesDescription")}>
            <AdminChart data={curves} title={t("curvesTitle")} />
          </AdminCard>
        </div>
      )}
    </Show>
  );
}

async function Heatmap({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("retention heatmap", () => retentionHeatmap(q)),
    getTranslations("metrics.items.usage_heatmap"),
  ]);
  return (
    <AdminCard title={t("name")} description={t("description")}>
      <Show loaded={loaded}>{(grid) => <UsageHeatmap grid={grid} />}</Show>
    </AdminCard>
  );
}

async function Charts({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("retention charts", () => retentionCharts(q)),
    getTranslations("admin.retention.charts"),
  ]);
  return (
    <Show loaded={loaded}>
      {(charts) => (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {charts.map((chart) => {
            const name = chart.id.split(".")[1];
            return (
              <AdminCard key={chart.id} title={t(name)}>
                <AdminChart data={chart} title={t(name)} />
              </AdminCard>
            );
          })}
        </div>
      )}
    </Show>
  );
}

async function More({ q }: { q: AdminQuery }) {
  const [sessions, activeDays, breakdowns, t, tRetention] = await Promise.all([
    safe("retention sessions", () => retentionSessions(q)),
    safe("retention active days", () => retentionActiveDays(q)),
    safe("retention breakdowns", () => retentionBreakdowns(q)),
    getTranslations("metrics.items"),
    getTranslations("admin.retention"),
  ]);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
      <AdminCard title={t("session_stats.name")} description={t("session_stats.description")}>
        <Show loaded={sessions}>{(data) => <FieldsGrid data={data} />}</Show>
      </AdminCard>
      <AdminCard title={t("active_days_per_week.name")} description={tRetention("activeDaysHint")}>
        <Show loaded={activeDays}>{(data) => <BreakdownList data={data} />}</Show>
      </AdminCard>
      <Show loaded={breakdowns}>
        {(blocks) =>
          blocks.map((block) => (
            <AdminCard
              key={block.key}
              title={t(`${block.key}.name`)}
              description={t(`${block.key}.description`)}
            >
              <BreakdownList data={block} />
            </AdminCard>
          ))
        }
      </Show>
    </div>
  );
}
