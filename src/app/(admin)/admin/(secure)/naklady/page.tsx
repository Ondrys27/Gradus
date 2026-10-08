import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import {
  costBreakdownFields,
  costsBreakdowns,
  costsTiles,
  marginByPlanRows,
  trialFields,
} from "@/features/admin/server/page-data";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "@/features/admin/format-metric";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminCard, GridSkeleton, TilesSkeleton } from "@/features/admin/ui/blocks";
import { BreakdownList, DataTable, FieldsGrid } from "@/features/admin/ui/data-blocks";
import { TileGrid } from "@/features/admin/ui/metric-tile";
import { formatNumber } from "@/lib/format";
import { viewKey } from "@/features/admin/view-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.costs");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminCostsPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "costs");
  const q = adminQuery(await searchParams);
  const key = viewKey(q.view, q.range);

  return (
    <>
      <AdminPageHeader section="costs" q={q} />
      <Suspense key={`tiles:${key}`} fallback={<TilesSkeleton count={3} />}>
        <Tiles q={q} />
      </Suspense>
      <Suspense key={`breakdown:${key}`} fallback={<GridSkeleton count={2} height={180} />}>
        <BreakdownFields q={q} />
      </Suspense>
      <Suspense key={`margin:${key}`} fallback={<GridSkeleton count={1} height={240} />}>
        <Margin q={q} />
      </Suspense>
      <Suspense key={`trial:${key}`} fallback={<GridSkeleton count={2} height={180} />}>
        <Trial q={q} />
      </Suspense>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("costs tiles", () => costsTiles(q));
  return <Show loaded={loaded}>{(tiles) => <TileGrid tiles={tiles} />}</Show>;
}

async function BreakdownFields({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("cost breakdown", () => costBreakdownFields(q)),
    getTranslations("metrics.items.cost_breakdown"),
  ]);
  return (
    <AdminCard title={t("name")} description={t("description")}>
      <Show loaded={loaded}>{(data) => <FieldsGrid data={data} />}</Show>
    </AdminCard>
  );
}

async function Margin({ q }: { q: AdminQuery }) {
  const [loaded, tItem, t, tUnits] = await Promise.all([
    safe("margin by plan", () => marginByPlanRows(q)),
    getTranslations("metrics.items.margin_by_plan"),
    getTranslations("admin.costs"),
    getTranslations("admin.units"),
  ]);
  const czk = (value: number | null, decimals = 0) =>
    value === null
      ? tUnits("none")
      : formatNumber(value, { style: "currency", currency: "CZK", decimals }, ADMIN_FORMAT_SETTINGS);
  return (
    <AdminCard title={tItem("name")} description={tItem("description")}>
      <Show loaded={loaded}>
        {(rows) => (
          <DataTable
            id="costs.margin"
            rows={rows}
            columns={[
              { key: "plan", label: t("columns.plan"), render: (row) => row.plan },
              {
                key: "price_czk",
                label: t("columns.price"),
                align: "right",
                render: (row) => czk(row.priceCzk),
                csv: (row) => row.priceCzk,
              },
              {
                key: "cost_per_active_user_czk",
                label: t("columns.costPerUser"),
                align: "right",
                render: (row) => czk(row.costPerActiveUserCzk, 1),
                csv: (row) => row.costPerActiveUserCzk,
              },
              {
                key: "margin_czk",
                label: t("columns.margin"),
                align: "right",
                render: (row) => czk(row.marginCzk),
                csv: (row) => row.marginCzk,
              },
              {
                key: "margin_share",
                label: t("columns.marginShare"),
                align: "right",
                render: (row) =>
                  row.marginShare === null
                    ? tUnits("none")
                    : formatMetricValue(row.marginShare * 100, "percent", tUnits),
                csv: (row) => row.marginShare,
              },
            ]}
          />
        )}
      </Show>
    </AdminCard>
  );
}

async function Trial({ q }: { q: AdminQuery }) {
  const [trial, breakdowns, t] = await Promise.all([
    safe("trial fields", () => trialFields(q)),
    safe("costs breakdowns", () => costsBreakdowns(q)),
    getTranslations("metrics.items"),
  ]);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <AdminCard title={t("trials.name")} description={t("trials.description")}>
        <Show loaded={trial}>{(data) => <FieldsGrid data={data} />}</Show>
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
