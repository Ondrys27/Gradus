import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import {
  growthCharts,
  growthDistributions,
  growthFields,
  growthTiles,
} from "@/features/admin/server/page-data";
import { AdminChart } from "@/features/admin/ui/admin-chart";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminCard, GridSkeleton, TilesSkeleton } from "@/features/admin/ui/blocks";
import { BreakdownList, FieldsGrid } from "@/features/admin/ui/data-blocks";
import { TileGrid } from "@/features/admin/ui/metric-tile";
import { viewKey } from "@/features/admin/view-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.growth");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminGrowthPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "growth");
  const q = adminQuery(await searchParams);
  const key = viewKey(q.view, q.range);

  return (
    <>
      <AdminPageHeader section="growth" q={q} />
      <Suspense key={`tiles:${key}`} fallback={<TilesSkeleton count={8} />}>
        <Tiles q={q} />
      </Suspense>
      <Suspense key={`charts:${key}`} fallback={<GridSkeleton count={4} />}>
        <Charts q={q} />
      </Suspense>
      <Suspense key={`fields:${key}`} fallback={<GridSkeleton count={2} height={120} />}>
        <Fields q={q} />
      </Suspense>
      <Suspense key={`dist:${key}`} fallback={<GridSkeleton count={4} height={160} />}>
        <Distributions q={q} />
      </Suspense>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("growth tiles", () => growthTiles(q));
  return <Show loaded={loaded}>{(tiles) => <TileGrid tiles={tiles} />}</Show>;
}

async function Charts({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("growth charts", () => growthCharts(q)),
    getTranslations("admin.growth.charts"),
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

async function Fields({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("growth fields", () => growthFields(q)),
    getTranslations("metrics.items"),
  ]);
  return (
    <Show loaded={loaded}>
      {(blocks) => (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {blocks.map((block) => (
            <AdminCard
              key={block.key}
              title={t(`${block.key}.name`)}
              description={t(`${block.key}.description`)}
            >
              <FieldsGrid data={block} />
            </AdminCard>
          ))}
        </div>
      )}
    </Show>
  );
}

async function Distributions({ q }: { q: AdminQuery }) {
  const [loaded, t, tGrowth] = await Promise.all([
    safe("growth distributions", () => growthDistributions(q)),
    getTranslations("metrics.items"),
    getTranslations("admin.growth"),
  ]);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold text-ink">{tGrowth("distributionsTitle")}</h2>
        <p className="text-sm text-ink-muted">{tGrowth("distributionsDescription")}</p>
      </div>
      <Show loaded={loaded}>
        {(blocks) => (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {blocks.map((block) => (
              <AdminCard key={block.key} title={t(`${block.key}.name`)}>
                <BreakdownList data={block} />
              </AdminCard>
            ))}
          </div>
        )}
      </Show>
    </section>
  );
}
