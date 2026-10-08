import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AnalyticsSection } from "@/lib/analytics/routes";
import { formatCurrency } from "@/lib/format";
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
import { AdminCard, CardSkeleton, GridSkeleton, TilesSkeleton } from "@/features/admin/ui/blocks";
import { BreakdownList, DataTable, FieldsGrid } from "@/features/admin/ui/data-blocks";
import { TileGrid } from "@/features/admin/ui/metric-tile";
import { viewKey, viewQuery, parseAdminView } from "@/features/admin/view-state";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.features");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function isSection(value: string | undefined): value is AnalyticsSection {
  return (FEATURE_SECTIONS as readonly string[]).includes(value ?? "");
}

export default async function AdminFeaturesPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "features");
  const params = await searchParams;
  const q = adminQuery(params);
  const key = viewKey(q.view, q.range);
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab: AnalyticsSection = isSection(rawTab) ? rawTab : FEATURE_SECTIONS[0];
  const query = viewQuery(parseAdminView(params));

  const [t, tShell] = await Promise.all([
    getTranslations("admin.features"),
    getTranslations("admin.shell"),
  ]);

  return (
    <>
      <AdminPageHeader section="features" q={q} />

      <Suspense key={`adoption:${key}`} fallback={<CardSkeleton height={260} />}>
        <Adoption q={q} />
      </Suspense>

      <nav
        aria-label={t("tabs")}
        className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
      >
        {FEATURE_SECTIONS.map((section) => {
          const active = section === tab;
          return (
            <Link
              key={section}
              href={`${ADMIN_PATH}/funkce?tab=${section}${query ? `&${query.slice(1)}` : ""}`}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-9",
                active ? "bg-violet/20 text-ink" : "text-ink-soft hover:bg-surface-hover hover:text-ink",
              )}
            >
              {tShell(`nav.${section}`)}
            </Link>
          );
        })}
      </nav>

      <Suspense key={`section:${key}:${tab}`} fallback={<SectionSkeleton />}>
        <Section q={q} section={tab} />
      </Suspense>
    </>
  );
}

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <CardSkeleton height={220} />
      <TilesSkeleton count={6} />
      <GridSkeleton count={3} height={160} />
    </div>
  );
}

async function Adoption({ q }: { q: AdminQuery }) {
  const [loaded, t, tUnits, tShell] = await Promise.all([
    safe("feature adoption", () => featureAdoption(q)),
    getTranslations("admin.features"),
    getTranslations("admin.units"),
    getTranslations("admin.shell"),
  ]);
  return (
    <AdminCard title={t("adoptionTitle")} description={t("adoptionDescription")}>
      <Show loaded={loaded}>
        {(rows) => (
          <DataTable
            id="features.adoption"
            rows={rows}
            columns={[
              {
                key: "section",
                label: t("columns.section"),
                render: (row) =>
                  tShell.has(`nav.${row.section}`) ? tShell(`nav.${row.section}`) : row.section,
              },
              {
                key: "pct",
                label: t("columns.adoption"),
                align: "right",
                render: (row) => (row.pct === null ? tUnits("none") : `${row.pct.toFixed(0)} %`),
                csv: (row) => row.pct,
              },
              {
                key: "actions",
                label: t("columns.actions"),
                align: "right",
                render: (row) => String(row.actions ?? 0),
                csv: (row) => row.actions,
              },
              {
                key: "actionsPerUser",
                label: t("columns.actionsPerUser"),
                align: "right",
                render: (row) =>
                  row.actionsPerUser === null ? tUnits("none") : row.actionsPerUser.toFixed(1),
                csv: (row) => row.actionsPerUser,
              },
            ]}
          />
        )}
      </Show>
    </AdminCard>
  );
}

async function Section({ q, section }: { q: AdminQuery; section: AnalyticsSection }) {
  const [tiles, breakdowns, trend, t] = await Promise.all([
    safe(`features ${section} tiles`, () => featureSectionTiles(q, section)),
    safe(`features ${section} breakdowns`, () => featureSectionBreakdowns(q, section)),
    safe(`features ${section} trend`, () => featureSectionTrend(q, section)),
    getTranslations("metrics.items"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      {trend.ok && trend.data && (
        <AdminCard>
          <AdminChart data={trend.data} title={t(`${trend.data.series[0].key}.name`)} />
        </AdminCard>
      )}
      <Show loaded={tiles}>{(data) => <TileGrid tiles={data} />}</Show>
      <Show loaded={breakdowns}>
        {(blocks) =>
          blocks.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {blocks.map((block) => (
                <AdminCard
                  key={block.key}
                  title={t(`${block.key}.name`)}
                  description={t(`${block.key}.description`)}
                >
                  <BreakdownList data={block} />
                </AdminCard>
              ))}
            </div>
          )
        }
      </Show>
      <SectionExtra q={q} section={section} />
    </div>
  );
}

/** The handful of metrics that are not a tile or a breakdown: tables built by hand. */
async function SectionExtra({ q, section }: { q: AdminQuery; section: AnalyticsSection }) {
  const [t, tItems, tUnits, settings] = await Promise.all([
    getTranslations("admin.features"),
    getTranslations("metrics.items"),
    getTranslations("admin.units"),
    Promise.resolve(ADMIN_FORMAT_SETTINGS),
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
              rows={rows}
              columns={[
                {
                  key: "key",
                  label: t("columns.group"),
                  render: (row) => (row.key === "true" ? t("fromTemplate") : t("custom")),
                },
                {
                  key: "p50",
                  label: t("columns.medianDays"),
                  align: "right",
                  render: (row) => (row.p50 === null ? tUnits("none") : row.p50.toFixed(1)),
                  csv: (row) => row.p50,
                },
              ]}
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
        {(rows) => <MoneyTable id="features.deal_value" title={tItems("deal_value.name")} rows={rows} t={t} settings={settings} />}
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
              rows={rows}
              columns={[
                { key: "keyword", label: t("columns.keyword"), render: (row) => row.keyword },
                {
                  key: "searches",
                  label: t("columns.searches"),
                  align: "right",
                  render: (row) => String(row.searches ?? 0),
                  csv: (row) => row.searches,
                },
              ]}
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
          <MoneyTable id="features.finance_value" title={tItems("finance_value.name")} rows={rows} t={t} settings={settings} />
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
  settings,
}: {
  id: string;
  title: string;
  rows: { metric: string; currency: string; items: number | null; total: number | null }[];
  t: Awaited<ReturnType<typeof getTranslations>>;
  settings: typeof ADMIN_FORMAT_SETTINGS;
}) {
  return (
    <AdminCard title={title}>
      <DataTable
        id={id}
        rows={rows}
        columns={[
          { key: "metric", label: t("columns.metric"), render: (row) => t(`moneyMetric.${row.metric}`) },
          { key: "currency", label: t("columns.currency"), render: (row) => row.currency },
          {
            key: "items",
            label: t("columns.count"),
            align: "right",
            render: (row) => String(row.items ?? 0),
            csv: (row) => row.items,
          },
          {
            key: "total",
            label: t("columns.total"),
            align: "right",
            render: (row) => formatCurrency(row.total ?? 0, row.currency, settings),
            csv: (row) => row.total,
          },
        ]}
      />
    </AdminCard>
  );
}
