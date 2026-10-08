import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import { overviewChart, overviewTiles } from "@/features/admin/server/page-data";
import { AdminChart } from "@/features/admin/ui/admin-chart";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminCard, CardSkeleton, TilesSkeleton } from "@/features/admin/ui/blocks";
import { TileGrid } from "@/features/admin/ui/metric-tile";
import { viewKey } from "@/features/admin/view-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.overview");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminOverviewPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "overview");
  const q = adminQuery(await searchParams);
  const key = viewKey(q.view, q.range);

  return (
    <>
      <AdminPageHeader section="overview" q={q} />
      <Suspense key={`tiles:${key}`} fallback={<TilesSkeleton count={10} />}>
        <Tiles q={q} />
      </Suspense>
      <Suspense key={`chart:${key}`} fallback={<CardSkeleton height={320} />}>
        <MainChart q={q} />
      </Suspense>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("overview tiles", () => overviewTiles(q));
  return <Show loaded={loaded}>{(tiles) => <TileGrid tiles={tiles} />}</Show>;
}

async function MainChart({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("overview chart", () => overviewChart(q)),
    getTranslations("admin.overview"),
  ]);
  return (
    <AdminCard title={t("chartTitle")} description={t("chartDescription")}>
      <Show loaded={loaded}>
        {(data) => <AdminChart data={data} title={t("chartTitle")} height={320} />}
      </Show>
    </AdminCard>
  );
}
