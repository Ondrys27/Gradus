import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { cacheHitRate } from "@/lib/analytics/metrics";
import { ADMIN_PATH } from "@/features/admin/access";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import {
  aiBreakdowns,
  aiByFeature,
  aiByModel,
  aiCostChart,
  aiErrors,
  aiTiles,
  aiTopUsers,
  jarvisConversations,
  type AiUsageRow,
} from "@/features/admin/server/page-data";
import { AdminChart } from "@/features/admin/ui/admin-chart";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminCard, GridSkeleton, TilesSkeleton } from "@/features/admin/ui/blocks";
import { BreakdownList, DataTable, FieldsGrid } from "@/features/admin/ui/data-blocks";
import { TileGrid } from "@/features/admin/ui/metric-tile";
import { formatMetricValue } from "@/features/admin/format-metric";
import { viewKey } from "@/features/admin/view-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.ai");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminAiPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "ai");
  const q = adminQuery(await searchParams);
  const key = viewKey(q.view, q.range);

  return (
    <>
      <AdminPageHeader section="ai" q={q} />
      <Suspense key={`tiles:${key}`} fallback={<TilesSkeleton count={6} />}>
        <Tiles q={q} />
      </Suspense>
      <Suspense key={`cost:${key}`} fallback={<GridSkeleton count={1} />}>
        <CostChart q={q} />
      </Suspense>
      <Suspense key={`usage:${key}`} fallback={<GridSkeleton count={2} height={220} />}>
        <Usage q={q} />
      </Suspense>
      <Suspense key={`more:${key}`} fallback={<GridSkeleton count={3} height={180} />}>
        <More q={q} />
      </Suspense>
      <Suspense key={`top:${key}`} fallback={<GridSkeleton count={1} height={260} />}>
        <TopUsers q={q} />
      </Suspense>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("ai tiles", () => aiTiles(q));
  return <Show loaded={loaded}>{(tiles) => <TileGrid tiles={tiles} />}</Show>;
}

async function CostChart({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("ai cost chart", () => aiCostChart(q)),
    getTranslations("metrics.items.ai_cost"),
  ]);
  return (
    <AdminCard title={t("name")} description={t("description")}>
      <Show loaded={loaded}>{(chart) => <AdminChart data={chart} title={t("name")} />}</Show>
    </AdminCard>
  );
}

function usageColumns(
  t: Awaited<ReturnType<typeof getTranslations>>,
  tUnits: Awaited<ReturnType<typeof getTranslations>>,
) {
  return [
    { key: "key", label: t("columns.key"), render: (row: AiUsageRow) => row.key },
    {
      key: "calls",
      label: t("columns.calls"),
      align: "right" as const,
      render: (row: AiUsageRow) => String(row.calls ?? 0),
      csv: (row: AiUsageRow) => row.calls,
    },
    {
      key: "users",
      label: t("columns.users"),
      align: "right" as const,
      render: (row: AiUsageRow) => String(row.users ?? 0),
      csv: (row: AiUsageRow) => row.users,
    },
    {
      key: "cost_usd",
      label: t("columns.cost"),
      align: "right" as const,
      render: (row: AiUsageRow) => formatMetricValue(row.costUsd, "usd", tUnits),
      csv: (row: AiUsageRow) => row.costUsd,
    },
    {
      key: "cache_hit_rate",
      label: t("columns.cacheHit"),
      align: "right" as const,
      render: (row: AiUsageRow) => {
        const rate = cacheHitRate({
          input_tokens: row.inputTokens ?? 0,
          cache_read_tokens: row.cacheReadTokens ?? 0,
          cache_write_tokens: row.cacheWriteTokens ?? 0,
        });
        return rate === null ? tUnits("none") : `${Math.round(rate * 100)} %`;
      },
    },
    {
      key: "p50_ms",
      label: t("columns.p50"),
      align: "right" as const,
      render: (row: AiUsageRow) => formatMetricValue(row.p50Ms, "ms", tUnits),
      csv: (row: AiUsageRow) => row.p50Ms,
    },
    {
      key: "p95_ms",
      label: t("columns.p95"),
      align: "right" as const,
      render: (row: AiUsageRow) => formatMetricValue(row.p95Ms, "ms", tUnits),
      csv: (row: AiUsageRow) => row.p95Ms,
    },
  ];
}

async function Usage({ q }: { q: AdminQuery }) {
  const [byFeature, byModel, t, tItems, tUnits] = await Promise.all([
    safe("ai by feature", () => aiByFeature(q)),
    safe("ai by model", () => aiByModel(q)),
    getTranslations("admin.ai"),
    getTranslations("metrics.items"),
    getTranslations("admin.units"),
  ]);
  const columns = usageColumns(t, tUnits);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <AdminCard title={tItems("ai_by_feature.name")} description={tItems("ai_by_feature.description")}>
        <Show loaded={byFeature}>{(rows) => <DataTable id="ai.by_feature" rows={rows} columns={columns} />}</Show>
      </AdminCard>
      <AdminCard title={tItems("ai_by_model.name")} description={tItems("ai_by_model.description")}>
        <Show loaded={byModel}>{(rows) => <DataTable id="ai.by_model" rows={rows} columns={columns} />}</Show>
      </AdminCard>
    </div>
  );
}

async function More({ q }: { q: AdminQuery }) {
  const [breakdowns, errors, conversations, t, tItems] = await Promise.all([
    safe("ai breakdowns", () => aiBreakdowns(q)),
    safe("ai errors", () => aiErrors(q)),
    safe("jarvis conversations", () => jarvisConversations(q)),
    getTranslations("admin.ai"),
    getTranslations("metrics.items"),
  ]);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
      <AdminCard title={tItems("jarvis_conversations.name")} description={tItems("jarvis_conversations.description")}>
        <Show loaded={conversations}>{(data) => <FieldsGrid data={data} />}</Show>
      </AdminCard>
      <AdminCard title={tItems("ai_errors.name")} description={tItems("ai_errors.description")}>
        <Show loaded={errors}>
          {(rows) => (
            <DataTable
              id="ai.errors"
              rows={rows}
              columns={[
                { key: "key", label: t("columns.key"), render: (row) => row.key },
                {
                  key: "calls",
                  label: t("columns.calls"),
                  align: "right",
                  render: (row) => String(row.calls ?? 0),
                  csv: (row) => row.calls,
                },
              ]}
            />
          )}
        </Show>
      </AdminCard>
      <Show loaded={breakdowns}>
        {(blocks) =>
          blocks.map((block) => (
            <AdminCard
              key={block.key}
              title={tItems(`${block.key}.name`)}
              description={tItems(`${block.key}.description`)}
            >
              <BreakdownList data={block} />
            </AdminCard>
          ))
        }
      </Show>
    </div>
  );
}

async function TopUsers({ q }: { q: AdminQuery }) {
  const [loaded, t, tUnits] = await Promise.all([
    safe("ai top users", () => aiTopUsers(q)),
    getTranslations("admin.ai"),
    getTranslations("admin.units"),
  ]);
  return (
    <AdminCard title={t("topUsersTitle")} description={t("topUsersDescription")}>
      <Show loaded={loaded}>
        {(rows) => (
          <DataTable
            id="ai.top_users"
            rows={rows}
            columns={[
              {
                key: "user_id",
                label: t("columns.user"),
                render: (row) => row.userId.slice(0, 8),
              },
              { key: "plan", label: t("columns.plan"), render: (row) => row.plan },
              {
                key: "calls",
                label: t("columns.calls"),
                align: "right",
                render: (row) => String(row.calls ?? 0),
                csv: (row) => row.calls,
              },
              {
                key: "cost_usd",
                label: t("columns.cost"),
                align: "right",
                render: (row) => formatMetricValue(row.costUsd, "usd", tUnits),
                csv: (row) => row.costUsd,
              },
            ]}
          />
        )}
      </Show>
      {loaded.ok && loaded.data.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {loaded.data.map((row) => (
            <li key={row.userId}>
              <Link
                href={`${ADMIN_PATH}/uzivatele/${row.userId}`}
                prefetch={false}
                className="text-xs text-violet underline-offset-2 hover:underline"
              >
                {t("openDetail", { id: row.userId.slice(0, 8) })}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminCard>
  );
}
