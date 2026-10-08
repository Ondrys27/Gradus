import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import {
  gameBreakdowns,
  gameChart,
  gameTiles,
  xpSources,
} from "@/features/admin/server/page-data";
import { AdminChart } from "@/features/admin/ui/admin-chart";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminCard, GridSkeleton, TilesSkeleton } from "@/features/admin/ui/blocks";
import { BreakdownList } from "@/features/admin/ui/data-blocks";
import { TileGrid } from "@/features/admin/ui/metric-tile";
import { viewKey } from "@/features/admin/view-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.game");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminGamePage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "game");
  const q = adminQuery(await searchParams);
  const key = viewKey(q.view, q.range);

  return (
    <>
      <AdminPageHeader section="game" q={q} />
      <Suspense key={`tiles:${key}`} fallback={<TilesSkeleton count={2} />}>
        <Tiles q={q} />
      </Suspense>
      <Suspense key={`chart:${key}`} fallback={<GridSkeleton count={1} />}>
        <Chart q={q} />
      </Suspense>
      <Suspense key={`more:${key}`} fallback={<GridSkeleton count={4} height={180} />}>
        <More q={q} />
      </Suspense>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("game tiles", () => gameTiles(q));
  return <Show loaded={loaded}>{(tiles) => <TileGrid tiles={tiles} />}</Show>;
}

async function Chart({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("game xp chart", () => gameChart(q)),
    getTranslations("metrics.items.xp_per_day"),
  ]);
  return (
    <AdminCard title={t("name")} description={t("description")}>
      <Show loaded={loaded}>{(chart) => <AdminChart data={chart} title={t("name")} />}</Show>
    </AdminCard>
  );
}

async function More({ q }: { q: AdminQuery }) {
  const [breakdowns, sources, t] = await Promise.all([
    safe("game breakdowns", () => gameBreakdowns(q)),
    safe("xp sources", () => xpSources(q)),
    getTranslations("metrics.items"),
  ]);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
      <AdminCard title={t("xp_sources.name")} description={t("xp_sources.description")}>
        <Show loaded={sources}>{(data) => <BreakdownList data={data} />}</Show>
      </AdminCard>
      <Show loaded={breakdowns}>
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
