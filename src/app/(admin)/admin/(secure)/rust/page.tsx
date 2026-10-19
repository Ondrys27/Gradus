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
import {
  AdminCard,
  BlockGrid,
  FiguresSkeleton,
  GridSkeleton,
  PageSection,
} from "@/features/admin/ui/blocks";
import { BreakdownList, FieldsGrid } from "@/features/admin/ui/data-blocks";
import { Figures } from "@/features/admin/ui/metric-tile";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.growth");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminGrowthPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "growth");
  const q = adminQuery(await searchParams, "growth");

  return (
    <>
      <AdminPageHeader section="growth" q={q} />
      <div className="flex flex-col gap-6">
        <Suspense fallback={<FiguresSkeleton more={4} />}>
          <Tiles q={q} />
        </Suspense>
        <Suspense fallback={<GridSkeleton count={4} />}>
          <Charts q={q} />
        </Suspense>
        <Suspense fallback={<GridSkeleton count={2} height={120} />}>
          <Fields q={q} />
        </Suspense>
        <Suspense fallback={<GridSkeleton count={6} height={160} columns={3} />}>
          <Distributions q={q} />
        </Suspense>
      </div>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("growth tiles", () => growthTiles(q));
  return <Show loaded={loaded}>{(tiles) => <Figures tiles={tiles} />}</Show>;
}

async function Charts({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("growth charts", () => growthCharts(q)),
    getTranslations("admin.growth.charts"),
  ]);
  return (
    <Show loaded={loaded}>
      {(charts) => (
        <BlockGrid>
          {charts.map((chart) => {
            const name = chart.id.split(".")[1];
            return (
              <AdminCard key={chart.id} title={t(name)}>
                <AdminChart data={chart} title={t(name)} />
              </AdminCard>
            );
          })}
        </BlockGrid>
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
        <BlockGrid>
          {blocks.map((block) => (
            <AdminCard
              key={block.key}
              title={t(`${block.key}.name`)}
              description={t(`${block.key}.description`)}
            >
              <FieldsGrid data={block} />
            </AdminCard>
          ))}
        </BlockGrid>
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
    <PageSection title={tGrowth("distributionsTitle")} description={tGrowth("distributionsDescription")}>
      <Show loaded={loaded}>
        {(blocks) => (
          <BlockGrid columns={3}>
            {blocks.map((block) => (
              <AdminCard key={block.key} title={t(`${block.key}.name`)}>
                <BreakdownList data={block} />
              </AdminCard>
            ))}
          </BlockGrid>
        )}
      </Show>
    </PageSection>
  );
}
