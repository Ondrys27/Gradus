import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EVENTS, type EventName } from "@/lib/analytics/events";
import type { EventCalc } from "@/lib/analytics/metrics";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import {
  EXPLORER_CALCS,
  EXPLORER_EVENTS,
  EXPLORER_GRAINS,
  explorerChart,
  isValidExplorerQuery,
  numericPropsOf,
  type ExplorerGrain,
  type ExplorerQuery,
} from "@/features/admin/server/explorer-data";
import { AdminChart } from "@/features/admin/ui/admin-chart";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminCard, CardSkeleton } from "@/features/admin/ui/blocks";
import { DataTable } from "@/features/admin/ui/data-blocks";
import { ExplorerControls } from "@/features/admin/ui/explorer-controls";
import { viewKey } from "@/features/admin/view-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.explorer");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const DEFAULT_QUERY: ExplorerQuery = {
  event: "app_opened",
  calc: "count",
  prop: null,
  grain: "day",
};

function parseQuery(params: Record<string, string | string[] | undefined>): ExplorerQuery {
  const event = first(params.event);
  const calc = first(params.calc);
  const grain = first(params.grain);
  const prop = first(params.prop);
  const query: ExplorerQuery = {
    event: (EXPLORER_EVENTS as readonly string[]).includes(event) ? (event as EventName) : DEFAULT_QUERY.event,
    calc: (EXPLORER_CALCS as readonly string[]).includes(calc) ? (calc as EventCalc) : DEFAULT_QUERY.calc,
    prop: prop || null,
    grain: (EXPLORER_GRAINS as readonly string[]).includes(grain) ? (grain as ExplorerGrain) : DEFAULT_QUERY.grain,
  };
  return isValidExplorerQuery(query) ? query : { ...DEFAULT_QUERY, event: query.event };
}

export default async function AdminExplorerPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "explorer");
  const params = await searchParams;
  const q = adminQuery(params);
  const key = viewKey(q.view, q.range);
  const query = parseQuery(params);

  const numericPropsByEvent = Object.fromEntries(
    EXPLORER_EVENTS.map((event) => [event, numericPropsOf(event)]),
  );

  return (
    <>
      <AdminPageHeader section="explorer" q={q} />
      <AdminCard>
        <ExplorerControls events={EXPLORER_EVENTS} numericPropsByEvent={numericPropsByEvent} current={query} />
      </AdminCard>
      <Suspense key={`chart:${key}:${JSON.stringify(query)}`} fallback={<CardSkeleton height={320} />}>
        <Result q={q} query={query} />
      </Suspense>
    </>
  );
}

async function Result({ q, query }: { q: AdminQuery; query: ExplorerQuery }) {
  const [loaded, t] = await Promise.all([
    safe("explorer chart", () => explorerChart(q, query)),
    getTranslations("admin.explorer"),
  ]);
  return (
    <AdminCard title={EVENTS[query.event] ? query.event : t("title")}>
      <Show loaded={loaded}>
        {(chart) => (
          <div className="flex flex-col gap-4">
            <AdminChart data={chart} title={query.event} />
            <DataTable
              id={`explorer.${query.event}`}
              rows={chart.rows}
              columns={[
                { key: "x", label: t("columns.period"), render: (row) => String(row.x) },
                {
                  key: "value",
                  label: t("columns.value"),
                  align: "right",
                  render: (row) => (row.value === null ? "–" : String(row.value)),
                  csv: (row) => (typeof row.value === "number" ? row.value : null),
                },
              ]}
            />
          </div>
        )}
      </Show>
    </AdminCard>
  );
}
