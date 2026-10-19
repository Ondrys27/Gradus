import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import { overviewChart, overviewTiles } from "@/features/admin/server/page-data";
import { AdminChart } from "@/features/admin/ui/admin-chart";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminCard, CardSkeleton, FiguresSkeleton } from "@/features/admin/ui/blocks";
import { Figures } from "@/features/admin/ui/metric-tile";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.overview");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminOverviewPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "overview");
  const q = adminQuery(await searchParams, "overview");

  return (
    <>
      <AdminPageHeader section="overview" q={q} />
      <div className="flex flex-col gap-4">
        <Suspense fallback={<FiguresSkeleton more={6} />}>
          <Tiles q={q} />
        </Suspense>
        <Suspense fallback={<CardSkeleton height={320} />}>
          <MainChart q={q} />
        </Suspense>
      </div>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("overview tiles", () => overviewTiles(q));
  return <Show loaded={loaded}>{(tiles) => <Figures tiles={tiles} />}</Show>;
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
