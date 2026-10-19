import { Suspense } from "react";
import { AdminViewLink } from "@/features/admin/ui/admin-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AnalyticsSection } from "@/lib/analytics/routes";
import { formatCurrency, formatNumber } from "@/lib/format";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import {
  callTimeFields,
  dealValue,
  FEATURE_SECTIONS,
  featureAdoption,
  featureSectionBreakdowns,
  featureSectionTiles,
  featureSectionTrend,
  financeValue,
  generationKeywords,
  milestoneDaysToComplete,
  workerInviteFields,
} from "@/features/admin/server/page-data";
import { ADMIN_FORMAT_SETTINGS } from "@/features/admin/format-metric";
import { ADMIN_PATH } from "@/features/admin/access";
import { AdminChart } from "@/features/admin/ui/admin-chart";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminCard, BlockGrid, FiguresSkeleton, GridSkeleton } from "@/features/admin/ui/blocks";
import { buildTable } from "@/features/admin/table";
import { BreakdownList, DataTable, FieldsGrid } from "@/features/admin/ui/data-blocks";
import { Figures } from "@/features/admin/ui/metric-tile";
import { viewQuery, parseAdminView } from "@/features/admin/view-state";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.features");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function isSection(value: string | undefined): value is AnalyticsSection {
  return (FEATURE_SECTIONS as readonly string[]).includes(value ?? "");
}

const SETTINGS = ADMIN_FORMAT_SETTINGS;
const count = (value: number | null) => formatNumber(value ?? 0, {}, SETTINGS);

export default async function AdminFeaturesPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "features");
  const params = await searchParams;
  const q = adminQuery(params, "features");
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab: AnalyticsSection = isSection(rawTab) ? rawTab : FEATURE_SECTIONS[0];
  const query = viewQuery(parseAdminView(params));

  const [t, tSections] = await Promise.all([
    getTranslations("admin.features"),
    getTranslations("admin.users.sections"),
  ]);

  // The tabs live in the sticky bar, so the section stays in reach while scrolling.
  const tabs = (
    <nav
      aria-label={t("tabs")}
      className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] lg:-mx-6 lg:px-6"
    >
      {FEATURE_SECTIONS.map((section) => {
        const active = section === tab;
        return (
          <AdminViewLink
            key={section}
            href={`${ADMIN_PATH}/funkce?tab=${section}${query ? `&${query.slice(1)}` : ""}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 shrink-0 items-center border-b-2 px-2.5 text-sm whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8",
              active
                ? "border-violet font-medium text-ink"
                : "border-transparent text-ink-soft hover:text-ink",
            )}
          >
            {tSections(section)}
          </AdminViewLink>
        );
      })}
    </nav>
  );

  return (
    <>
      <AdminPageHeader section="features" q={q} extra={tabs} />
      <div className="flex flex-col gap-4">
        <Suspense fallback={<SectionSkeleton />}>
          <Section q={q} section={tab} />
        </Suspense>
      </div>
    </>
  );
}

function SectionSkeleton() {
  return (
    <>
      <FiguresSkeleton count={4} />
      <GridSkeleton count={2} height={220} />
      <GridSkeleton count={3} height={160} columns={3} />
    </>
  );
}

async function Section({ q, section }: { q: AdminQuery; section: AnalyticsSection }) {
  const [tiles, breakdowns, trend, adoption, t, tItems, tUnits, tSections] = await Promise.all([
    safe(`features ${section} tiles`, () => featureSectionTiles(q, section)),
    safe(`features ${section} breakdowns`, () => featureSectionBreakdowns(q, section)),
    safe(`features ${section} trend`, () => featureSectionTrend(q, section)),
    safe("feature adoption", () => featureAdoption(q)),
    getTranslations("admin.features"),
    getTranslations("metrics.items"),
    getTranslations("admin.units"),
    getTranslations("admin.users.sections"),
  ]);

  return (
    <>
      <Show loaded={tiles}>{(data) => <Figures tiles={data} />}</Show>
      <BlockGrid>
        {trend.ok && trend.data && (
          <AdminCard title={tItems(`${trend.data.series[0].key}.name`)}>
            <AdminChart data={trend.data} title={tItems(`${trend.data.series[0].key}.name`)} />
          </AdminCard>
        )}
        <AdminCard title={t("adoptionTitle")} description={t("adoptionDescription")} wide={!(trend.ok && trend.data)}>
          <Show loaded={adoption}>
            {(rows) => (
              <DataTable
                id="features.adoption"
                table={buildTable(rows, [
                  {
                    key: "section",
                    label: t("columns.section"),
                    render: (row) =>
                      tSections.has(row.section) ? tSections(row.section) : row.section,
                  },
                  {
                    key: "pct",
                    label: t("columns.adoption"),
                    align: "right",
                    render: (row) =>
                      row.pct === null
                        ? tUnits("none")
                        : formatNumber(row.pct / 100, { style: "percent", decimals: 0 }, SETTINGS),
                    csv: (row) => row.pct,
                  },
                  {
                    key: "actions",
                    label: t("columns.actions"),
                    align: "right",
                    render: (row) => count(row.actions),
                    csv: (row) => row.actions,
                  },
                  {
                    key: "actionsPerUser",
                    label: t("columns.actionsPerUser"),
                    align: "right",
                    render: (row) =>
                      row.actionsPerUser === null
                        ? tUnits("none")
                        : formatNumber(row.actionsPerUser, { decimals: 1 }, SETTINGS),
                    csv: (row) => row.actionsPerUser,
                  },
                ])}
              />
            )}
          </Show>
        </AdminCard>
      </BlockGrid>
      <Show loaded={breakdowns}>
        {(blocks) =>
          blocks.length > 0 && (
            <BlockGrid columns={3}>
              {blocks.map((block) => (
                <AdminCard
                  key={block.key}
                  title={tItems(`${block.key}.name`)}
                  description={tItems(`${block.key}.description`)}
                >
                  <BreakdownList data={block} />
                </AdminCard>
              ))}
            </BlockGrid>
          )
        }
      </Show>
      <SectionExtra q={q} section={section} />
    </>
  );
}

/** The handful of metrics that are not a tile or a breakdown: tables built by hand. */
async function SectionExtra({ q, section }: { q: AdminQuery; section: AnalyticsSection }) {
  const [t, tItems, tUnits] = await Promise.all([
    getTranslations("admin.features"),
    getTranslations("metrics.items"),
    getTranslations("admin.units"),
  ]);

  if (section === "milestones") {
    const loaded = await safe("milestone days to complete", () => milestoneDaysToComplete(q));
    return (
      <Show loaded={loaded}>
        {(rows) => (
          <AdminCard
            title={tItems("milestone_days_to_complete.name")}
            description={tItems("milestone_days_to_complete.description")}
          >
            <DataTable
              id="features.milestone_days"
              table={buildTable(rows, [
                {
                  key: "key",
                  label: t("columns.group"),
                  render: (row) => (row.key === "true" ? t("fromTemplate") : t("custom")),
                },
                {
                  key: "p50",
                  label: t("columns.medianDays"),
                  align: "right",
                  render: (row) =>
                    row.p50 === null ? tUnits("none") : formatNumber(row.p50, { decimals: 1 }, SETTINGS),
                  csv: (row) => row.p50,
                },
              ])}
            />
          </AdminCard>
        )}
      </Show>
    );
  }

  if (section === "pipeline") {
    const loaded = await safe("deal value", () => dealValue(q));
    return (
      <Show loaded={loaded}>
        {(rows) => <MoneyTable id="features.deal_value" title={tItems("deal_value.name")} rows={rows} t={t} />}
      </Show>
    );
  }

  if (section === "generation") {
    const loaded = await safe("generation keywords", () => generationKeywords(q));
    return (
      <Show loaded={loaded}>
        {(rows) => (
          <AdminCard
            title={tItems("generation_keywords.name")}
            description={tItems("generation_keywords.description")}
          >
            <DataTable
              id="features.generation_keywords"
              table={buildTable(rows, [
                { key: "keyword", label: t("columns.keyword"), render: (row) => row.keyword },
                {
                  key: "searches",
                  label: t("columns.searches"),
                  align: "right",
                  render: (row) => count(row.searches),
                  csv: (row) => row.searches,
                },
              ])}
            />
          </AdminCard>
        )}
      </Show>
    );
  }

  if (section === "cold_calling") {
    const loaded = await safe("call time fields", () => callTimeFields(q));
    return (
      <Show loaded={loaded}>
        {(data) => (
          <AdminCard title={tItems("call_time.name")} description={tItems("call_time.description")}>
            <FieldsGrid data={data} />
          </AdminCard>
        )}
      </Show>
    );
  }

  if (section === "finance") {
    const loaded = await safe("finance value", () => financeValue(q));
    return (
      <Show loaded={loaded}>
        {(rows) => (
          <MoneyTable id="features.finance_value" title={tItems("finance_value.name")} rows={rows} t={t} />
        )}
      </Show>
    );
  }

  if (section === "workers") {
    const loaded = await safe("worker invite fields", () => workerInviteFields(q));
    return (
      <Show loaded={loaded}>
        {(data) => (
          <AdminCard
            title={tItems("worker_invites.name")}
            description={tItems("worker_invites.description")}
          >
            <FieldsGrid data={data} />
          </AdminCard>
        )}
      </Show>
    );
  }

  return null;
}

function MoneyTable({
  id,
  title,
  rows,
  t,
}: {
  id: string;
  title: string;
  rows: { metric: string; currency: string; items: number | null; total: number | null }[];
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <AdminCard title={title}>
      <DataTable
        id={id}
        table={buildTable(rows, [
          { key: "metric", label: t("columns.metric"), render: (row) => t(`moneyMetric.${row.metric}`) },
          { key: "currency", label: t("columns.currency"), render: (row) => row.currency },
          {
            key: "items",
            label: t("columns.count"),
            align: "right",
            render: (row) => count(row.items),
            csv: (row) => row.items,
          },
          {
            key: "total",
            label: t("columns.total"),
            align: "right",
            render: (row) => formatCurrency(row.total ?? 0, row.currency, SETTINGS),
            csv: (row) => row.total,
          },
        ])}
      />
    </AdminCard>
  );
}
