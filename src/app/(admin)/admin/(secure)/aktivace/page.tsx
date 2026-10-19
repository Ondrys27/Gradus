import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import {
  activationBreakdowns,
  activationFunnel,
  activationTiles,
} from "@/features/admin/server/page-data";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminCard, BlockGrid, CardSkeleton, FiguresSkeleton, GridSkeleton } from "@/features/admin/ui/blocks";
import { BreakdownList, Funnel } from "@/features/admin/ui/data-blocks";
import { Figures } from "@/features/admin/ui/metric-tile";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.activation");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminActivationPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "activation");
  const q = adminQuery(await searchParams, "activation");

  return (
    <>
      <AdminPageHeader section="activation" q={q} />
      <div className="flex flex-col gap-4">
        <Suspense fallback={<FiguresSkeleton count={3} />}>
          <Tiles q={q} />
        </Suspense>
        <Suspense fallback={<CardSkeleton height={420} />}>
          <FunnelBlock q={q} />
        </Suspense>
        <Suspense fallback={<GridSkeleton count={4} height={160} />}>
          <Breakdowns q={q} />
        </Suspense>
      </div>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("activation tiles", () => activationTiles(q));
  return <Show loaded={loaded}>{(tiles) => <Figures tiles={tiles} />}</Show>;
}

async function FunnelBlock({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("activation funnel", () => activationFunnel(q)),
    getTranslations("metrics.items.funnel"),
  ]);
  return (
    <AdminCard title={t("name")} description={t("description")}>
      <Show loaded={loaded}>{(steps) => <Funnel steps={steps} />}</Show>
    </AdminCard>
  );
}

async function Breakdowns({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("activation breakdowns", () => activationBreakdowns(q)),
    getTranslations("metrics.items"),
  ]);
  return (
    <Show loaded={loaded}>
      {(blocks) => (
        <BlockGrid>
          {blocks.map((block) => (
            <AdminCard
              key={block.key}
              title={t(`${block.key}.name`)}
              description={t(`${block.key}.description`)}
            >
              <BreakdownList data={block} />
            </AdminCard>
          ))}
        </BlockGrid>
      )}
    </Show>
  );
}
