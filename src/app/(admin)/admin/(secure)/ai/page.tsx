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
  aiTopSpaces,
  aiTopUsers,
  gradyConversations,
  type AiUsageRow,
} from "@/features/admin/server/page-data";
import { loadAiCapsOverview, loadPeriodSpend } from "@/features/admin/server/ai-caps-data";
import { budgetPeriod, describePeriod } from "@/features/admin/ai-budget-period";
import { loadBudget } from "@/features/grady/server/budget";
import { loadAiCaps } from "@/features/grady/server/caps";
import { loadGradyRules } from "@/features/grady/server/rules";
import { toGradyRulesForm } from "@/features/grady/rules";
import { AdminViewLink } from "@/features/admin/ui/admin-view";
import { GradyRulesForm } from "@/features/admin/ui/grady-rules-form";
import { viewQuery, parseAdminView } from "@/features/admin/view-state";
import { cn } from "@/lib/utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminChart } from "@/features/admin/ui/admin-chart";
import { AiCapsForm } from "@/features/admin/ui/ai-caps-form";
import { GradyPingCard } from "@/features/admin/ui/grady-ping-card";
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
import { ADMIN_FORMAT_SETTINGS, formatMetricValue, metricCsvValue } from "@/features/admin/format-metric";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.ai");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const count = (value: number | null) => formatNumber(value ?? 0, {}, ADMIN_FORMAT_SETTINGS);

const AI_TABS = ["overview", "rules"] as const;
type AiTab = (typeof AI_TABS)[number];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AdminAiPage({ searchParams }: Props) {
  const context = await requireAdmin();
  const params = await searchParams;
  const tab: AiTab = first(params.tab) === "rules" ? "rules" : "overview";
  await logAdminAction(context, "view", tab === "rules" ? "ai.rules" : "ai");
  const q = adminQuery(params, "ai");
  const query = viewQuery(parseAdminView(params));
  const t = await getTranslations("admin.ai");

  // The overview (numbers, budget, caps) and Grady's rules, as two tabs in the address.
  const tabs = (
    <nav aria-label={t("tabs")} className="flex gap-1">
      {AI_TABS.map((value) => {
        const active = value === tab;
        const search = [value === "rules" ? "tab=rules" : "", query.slice(1)].filter(Boolean).join("&");
        return (
          <AdminViewLink
            key={value}
            href={`${ADMIN_PATH}/ai${search ? `?${search}` : ""}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8",
              active
                ? "border-violet font-medium text-ink"
                : "border-transparent text-ink-soft hover:text-ink",
            )}
          >
            {t(`tab.${value}`)}
          </AdminViewLink>
        );
      })}
    </nav>
  );

  if (tab === "rules") {
    return (
      <>
        <AdminPageHeader section="ai" q={q} extra={tabs} />
        <Suspense fallback={<CardSkeleton height={520} />}>
          <Rules
            readOnly={!adminCan(context.role, "editGradyRules")}
            canTest={adminCan(context.role, "testGrady")}
          />
        </Suspense>
      </>
    );
  }

  return (
    <>
      <AdminPageHeader section="ai" q={q} extra={tabs} />
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
          <Suspense fallback={<GridSkeleton count={2} height={260} />}>
            <BlockGrid>
              <TopUsers q={q} exportable={mayExport(context.role, "table.ai.top_users.csv")} />
              <TopSpaces q={q} exportable={mayExport(context.role, "table.ai.top_spaces.csv")} />
            </BlockGrid>
          </Suspense>
        </div>
        {/* The caps change what Grady may spend: the one action with consequences, at the end. */}
        <Suspense fallback={<CardSkeleton height={260} />}>
          <Caps q={q} readOnly={!adminCan(context.role, "editAiCaps")} />
        </Suspense>
        {/* One paid call to the model: only the owner may spend it. */}
        {adminCan(context.role, "testGrady") && <ConnectionTest />}
      </div>
    </>
  );
}

async function Tiles({ q }: { q: AdminQuery }) {
  const loaded = await safe("ai tiles", () => aiTiles(q));
  return <Show loaded={loaded}>{(tiles) => <Figures tiles={tiles} />}</Show>;
}

/**
 * The budget card follows the range of the top bar: the calendar month for
 * 30 days, otherwise the range's spend against the monthly cap scaled to it
 * (ai-budget-period.ts). The cost chart follows the range too.
 */
async function BudgetAndCost({ q }: { q: AdminQuery }) {
  const period = budgetPeriod(q.view, q.range, q.today);
  const [budget, chart, t] = await Promise.all([
    safe("grady budget", async () => {
      const admin = createAdminClient();
      const [month, spend] = await Promise.all([
        loadAiCaps(admin, { fresh: true }).then((caps) => loadBudget(admin, new Date(), caps)),
        period.kind === "month" ? null : loadPeriodSpend(period.spend.from, period.spend.to),
      ]);
      return { month, spend };
    }),
    safe("ai cost chart", () => aiCostChart(q)),
    getTranslations("metrics.items.ai_cost"),
  ]);
  return (
    <BlockGrid>
      <AdminCard title={t("name")} description={t("description")}>
        <Show loaded={chart}>{(data) => <AdminChart data={data} title={t("name")} />}</Show>
      </AdminCard>
      <Show loaded={budget}>
        {(data) => <BudgetCard budget={data.month} period={period} spend={data.spend} />}
      </Show>
    </BlockGrid>
  );
}

/** The caps set here apply within a minute; under each the spend of the chosen period. */
async function Caps({ q, readOnly }: { q: AdminQuery; readOnly: boolean }) {
  const period = budgetPeriod(q.view, q.range, q.today);
  const [loaded, t, tPeriod] = await Promise.all([
    safe("ai caps", async () => {
      const [overview, spend] = await Promise.all([
        loadAiCapsOverview(),
        period.kind === "month" ? null : loadPeriodSpend(period.spend.from, period.spend.to),
      ]);
      return { overview, spend };
    }),
    getTranslations("admin.ai.caps"),
    getTranslations("admin.ai.period"),
  ]);
  return (
    <PageSection title={t("sectionTitle")} description={t("sectionDescription")}>
      <AdminCard title={t("title")} description={t("description")} id="stropy">
        <Show loaded={loaded}>
          {({ overview, spend }) => (
            <AiCapsForm
              saved={{
                monthlyUsd: overview.caps.monthlyUsd,
                perUserUsd: overview.caps.perUserUsd,
                warnPercent: Math.round(overview.caps.warnShare * 100),
              }}
              fromDefaults={overview.caps.source === "default"}
              period={{
                label: describePeriod(period, tPeriod, ADMIN_FORMAT_SETTINGS),
                factor: period.factor,
                monthly: period.kind === "month",
              }}
              spentUsd={spend ? spend.spentUsd : overview.spentUsd}
              topUserSpentUsd={spend ? spend.topUserSpentUsd : overview.topUserSpentUsd}
              readOnly={readOnly}
            />
          )}
        </Show>
      </AdminCard>
    </PageSection>
  );
}

/**
 * Grady's rules: the switches of what he brings up on his own, the numbers
 * of the timing and the owner's instructions (docs/grady-pravidla.md).
 * Read fresh here; the app reads them with a 30-second cache.
 */
async function Rules({ readOnly, canTest }: { readOnly: boolean; canTest: boolean }) {
  const [loaded, t] = await Promise.all([
    safe("grady rules", () => loadGradyRules(createAdminClient(), { fresh: true })),
    getTranslations("admin.ai.rules"),
  ]);
  return (
    <AdminCard title={t("title")} description={t("description")} id="pravidla">
      <Show loaded={loaded}>
        {(rules) => (
          <GradyRulesForm
            saved={toGradyRulesForm(rules)}
            fromDefaults={rules.source === "default"}
            readOnly={readOnly}
            canTest={canTest && !readOnly}
          />
        )}
      </Show>
    </AdminCard>
  );
}

async function ConnectionTest() {
  const t = await getTranslations("admin.ai.connection");
  return (
    <AdminCard title={t("title")} description={t("description")}>
      <GradyPingCard />
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
      csv: (row: AiUsageRow) => metricCsvValue(row.costUsd, "usd"),
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
    safe("grady conversations", () => gradyConversations(q)),
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
                csv: (row) => metricCsvValue(row.costUsd, "usd"),
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

/**
 * AI spend by space (step 22.5): every call made in a company counts to it,
 * the owner's and their people's, since the owner pays for them; the table
 * by user next to it says who spent what wherever they were.
 */
async function TopSpaces({ q, exportable }: { q: AdminQuery; exportable: boolean }) {
  const [loaded, t, tUnits] = await Promise.all([
    safe("ai top spaces", () => aiTopSpaces(q)),
    getTranslations("admin.ai"),
    getTranslations("admin.units"),
  ]);
  const nameOf = await peopleNamer(loaded.ok ? loaded.data.map((row) => row.spaceId) : []);
  return (
    <AdminCard title={t("topSpacesTitle")} description={t("topSpacesDescription")}>
      <Show loaded={loaded}>
        {(rows) => (
          <DataTable
            id="ai.top_spaces"
            exportable={exportable}
            table={buildTable(rows, [
              { key: "space_name", label: t("columns.space"), render: (row) => nameOf(row.spaceId) },
              { key: "space_id", label: t("columns.spaceId"), csvOnly: true, render: (row) => row.spaceId },
              { key: "plan", label: t("columns.plan"), render: (row) => row.plan },
              {
                key: "users",
                label: t("columns.users"),
                align: "right",
                render: (row) => count(row.users),
                csv: (row) => row.users,
              },
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
                csv: (row) => metricCsvValue(row.costUsd, "usd"),
              },
            ])}
          />
        )}
      </Show>
      {loaded.ok && loaded.data.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {loaded.data.map((row) => (
            <li key={row.spaceId}>
              <Link
                href={`${ADMIN_PATH}/uzivatele/${row.spaceId}`}
                prefetch={false}
                className="text-xs text-violet underline-offset-2 hover:underline"
              >
                {t("openDetail", { name: nameOf(row.spaceId) })}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminCard>
  );
}
