import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { cacheHitRate } from "@/lib/analytics/metrics";
import { formatNumber } from "@/lib/format";
import { ADMIN_PATH } from "@/features/admin/access";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminCan, mayExport } from "@/features/admin/roles";
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
import { loadAiCapsOverview } from "@/features/admin/server/ai-caps-data";
import { loadBudget } from "@/features/jarvis/server/budget";
import { loadAiCaps } from "@/features/jarvis/server/caps";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminChart } from "@/features/admin/ui/admin-chart";
import { AiCapsForm } from "@/features/admin/ui/ai-caps-form";
import { BudgetCard } from "@/features/admin/ui/budget-card";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import {
  AdminCard,
  BlockGrid,
  CardSkeleton,
  FiguresSkeleton,
  GridSkeleton,
  PageSection,
} from "@/features/admin/ui/blocks";
import { buildTable } from "@/features/admin/table";
import { peopleNamer } from "@/features/admin/server/people";
import { BreakdownList, DataTable, FieldsGrid } from "@/features/admin/ui/data-blocks";
import { Figures } from "@/features/admin/ui/metric-tile";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "@/features/admin/format-metric";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.ai");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const count = (value: number | null) => formatNumber(value ?? 0, {}, ADMIN_FORMAT_SETTINGS);

export default async function AdminAiPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "ai");
  const q = adminQuery(await searchParams, "ai");

  return (
    <>
      <AdminPageHeader section="ai" q={q} />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <Suspense fallback={<FiguresSkeleton more={1} />}>
            <Tiles q={q} />
          </Suspense>
          <Suspense fallback={<GridSkeleton count={2} />}>
            <BudgetAndCost q={q} />
          </Suspense>
          <Suspense fallback={<GridSkeleton count={2} height={220} />}>
            <Usage q={q} />
          </Suspense>
          <Suspense fallback={<GridSkeleton count={3} height={180} columns={3} />}>
            <More q={q} />
          </Suspense>
          <Suspense fallback={<CardSkeleton height={260} />}>
            <TopUsers q={q} exportable={mayExport(context.role, "table.ai.top_users.csv")} />
          </Suspense>
        </div>
        {/* The caps change what Jarvis may spend: the one action with consequences, at the end. */}
        <Suspense fallback={<CardSkeleton height={260} />}>
          <Caps readOnly={!adminCan(context.role, "editAiCaps")} />
        </Suspense>
      </div>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("ai tiles", () => aiTiles(q));
  return <Show loaded={loaded}>{(tiles) => <Figures tiles={tiles} />}</Show>;
}

/** The budget is always this calendar month, whatever range the controls show; the cost chart follows the range. */
async function BudgetAndCost({ q }: { q: AdminQuery }) {
  const [budget, chart, t] = await Promise.all([
    safe("jarvis budget", async () => {
      const admin = createAdminClient();
      return loadBudget(admin, new Date(), await loadAiCaps(admin, { fresh: true }));
    }),
    safe("ai cost chart", () => aiCostChart(q)),
    getTranslations("metrics.items.ai_cost"),
  ]);
  return (
    <BlockGrid>
      <AdminCard title={t("name")} description={t("description")}>
        <Show loaded={chart}>{(data) => <AdminChart data={data} title={t("name")} />}</Show>
      </AdminCard>
      <Show loaded={budget}>{(data) => <BudgetCard budget={data} />}</Show>
    </BlockGrid>
  );
}

/** The caps set here apply within a minute; this month's spend under each. */
async function Caps({ readOnly }: { readOnly: boolean }) {
  const [loaded, t] = await Promise.all([
    safe("ai caps", () => loadAiCapsOverview()),
    getTranslations("admin.ai.caps"),
  ]);
  return (
    <PageSection title={t("sectionTitle")} description={t("sectionDescription")}>
      <AdminCard title={t("title")} description={t("description")} id="stropy">
        <Show loaded={loaded}>
          {(overview) => (
            <AiCapsForm
              saved={{
                monthlyUsd: overview.caps.monthlyUsd,
                perUserUsd: overview.caps.perUserUsd,
                warnPercent: Math.round(overview.caps.warnShare * 100),
              }}
              fromDefaults={overview.caps.source === "default"}
              spentUsd={overview.spentUsd}
              topUserSpentUsd={overview.topUserSpentUsd}
              readOnly={readOnly}
            />
          )}
        </Show>
      </AdminCard>
    </PageSection>
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
      render: (row: AiUsageRow) => count(row.calls),
      csv: (row: AiUsageRow) => row.calls,
    },
    {
      key: "users",
      label: t("columns.users"),
      align: "right" as const,
      render: (row: AiUsageRow) => count(row.users),
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
        return rate === null
          ? tUnits("none")
          : formatNumber(rate, { style: "percent", decimals: 0 }, ADMIN_FORMAT_SETTINGS);
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
    <BlockGrid>
      <AdminCard title={tItems("ai_by_feature.name")} description={tItems("ai_by_feature.description")}>
        <Show loaded={byFeature}>{(rows) => <DataTable id="ai.by_feature" table={buildTable(rows, columns)} />}</Show>
      </AdminCard>
      <AdminCard title={tItems("ai_by_model.name")} description={tItems("ai_by_model.description")}>
        <Show loaded={byModel}>{(rows) => <DataTable id="ai.by_model" table={buildTable(rows, columns)} />}</Show>
      </AdminCard>
    </BlockGrid>
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
    <BlockGrid columns={3}>
      <AdminCard title={tItems("jarvis_conversations.name")} description={tItems("jarvis_conversations.description")}>
        <Show loaded={conversations}>{(data) => <FieldsGrid data={data} />}</Show>
      </AdminCard>
      <AdminCard title={tItems("ai_errors.name")} description={tItems("ai_errors.description")}>
        <Show loaded={errors}>
          {(rows) => (
            <DataTable
              id="ai.errors"
              table={buildTable(rows, [
                { key: "key", label: t("columns.key"), render: (row) => row.key },
                {
                  key: "calls",
                  label: t("columns.calls"),
                  align: "right",
                  render: (row) => count(row.calls),
                  csv: (row) => row.calls,
                },
              ])}
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
    </BlockGrid>
  );
}

async function TopUsers({ q, exportable }: { q: AdminQuery; exportable: boolean }) {
  const [loaded, t, tUnits] = await Promise.all([
    safe("ai top users", () => aiTopUsers(q)),
    getTranslations("admin.ai"),
    getTranslations("admin.units"),
  ]);
  const nameOf = await peopleNamer(loaded.ok ? loaded.data.map((row) => row.userId) : []);
  return (
    <AdminCard title={t("topUsersTitle")} description={t("topUsersDescription")}>
      <Show loaded={loaded}>
        {(rows) => (
          <DataTable
            id="ai.top_users"
            exportable={exportable}
            table={buildTable(rows, [
              {
                key: "user_name",
                label: t("columns.user"),
                render: (row) => nameOf(row.userId),
              },
              {
                key: "user_id",
                label: t("columns.userId"),
                csvOnly: true,
                render: (row) => row.userId,
              },
              { key: "plan", label: t("columns.plan"), render: (row) => row.plan },
              {
                key: "calls",
                label: t("columns.calls"),
                align: "right",
                render: (row) => count(row.calls),
                csv: (row) => row.calls,
              },
              {
                key: "cost_usd",
                label: t("columns.cost"),
                align: "right",
                render: (row) => formatMetricValue(row.costUsd, "usd", tUnits),
                csv: (row) => row.costUsd,
              },
            ])}
          />
        )}
      </Show>
      {loaded.ok && loaded.data.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {loaded.data.map((row) => (
            <li key={row.userId}>
              <Link
                href={`${ADMIN_PATH}/uzivatele/${row.userId}`}
                prefetch={false}
                className="text-xs text-violet underline-offset-2 hover:underline"
              >
                {t("openDetail", { name: nameOf(row.userId) })}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminCard>
  );
}
