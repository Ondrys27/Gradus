import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCalendarDate } from "@/lib/format";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import {
  featureRequestCounts,
  jarvisAnswerRatings,
  loadFeatureRequests,
  loadNpsComments,
  loadNpsSummary,
} from "@/features/admin/server/feedback-data";
import { ADMIN_FORMAT_SETTINGS } from "@/features/admin/format-metric";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminCard, GridSkeleton, TilesSkeleton } from "@/features/admin/ui/blocks";
import { BreakdownList } from "@/features/admin/ui/data-blocks";
import { FeatureRequestRowView } from "@/features/admin/ui/feature-request-row";
import { MetricTile } from "@/features/admin/ui/metric-tile";
import { FEATURE_REQUEST_STATUSES, type FeatureRequestStatus } from "@/features/admin/types";
import { viewKey } from "@/features/admin/view-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.feedback");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function isStatus(value: string | undefined): value is FeatureRequestStatus {
  return (FEATURE_REQUEST_STATUSES as readonly string[]).includes(value ?? "");
}

export default async function AdminFeedbackPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "feedback");
  const params = await searchParams;
  const q = adminQuery(params);
  const key = viewKey(q.view, q.range);
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = isStatus(rawStatus) ? rawStatus : null;

  return (
    <>
      <AdminPageHeader section="feedback" q={q} />
      <Suspense key={`nps:${key}`} fallback={<TilesSkeleton count={1} />}>
        <Nps q={q} />
      </Suspense>
      <Suspense key={`jarvis:${key}`} fallback={<GridSkeleton count={1} height={160} />}>
        <JarvisRatings q={q} />
      </Suspense>
      <Suspense
        key={`ideas:${status}:${q.view.internal}`}
        fallback={<GridSkeleton count={1} height={320} />}
      >
        <Ideas q={q} status={status} />
      </Suspense>
    </>
  );
}

async function Nps({ q }: { q: AdminQuery }) {
  const [loaded, comments, t] = await Promise.all([
    safe("nps summary", () => loadNpsSummary(q)),
    safe("nps comments", () => loadNpsComments(q.view.internal)),
    getTranslations("admin.feedback"),
  ]);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
      <Show loaded={loaded}>
        {(summary) => (
          <MetricTile
            tile={{
              key: "nps",
              unit: "count",
              value: summary.score,
              spark: undefined,
            }}
          />
        )}
      </Show>
      <AdminCard title={t("commentsTitle")} description={t("commentsDescription")}>
        <Show loaded={comments}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="py-4 text-sm text-ink-muted">{t("noComments")}</p>
            ) : (
              <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
                {rows.map((row, index) => (
                  <li key={index} className="rounded-xl border border-line px-3.5 py-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs text-ink-muted">
                      <span>{t("npsScoreBadge", { score: row.score })}</span>
                      <span>
                        {formatCalendarDate(row.createdAt.slice(0, 10), ADMIN_FORMAT_SETTINGS)}
                      </span>
                    </div>
                    <p className="text-sm text-ink">{row.comment}</p>
                  </li>
                ))}
              </ul>
            )
          }
        </Show>
      </AdminCard>
    </div>
  );
}

async function JarvisRatings({ q }: { q: AdminQuery }) {
  const [loaded, t] = await Promise.all([
    safe("jarvis answer ratings", () => jarvisAnswerRatings(q)),
    getTranslations("metrics.items.jarvis_answer_ratings"),
  ]);
  return (
    <AdminCard title={t("name")} description={t("description")}>
      <Show loaded={loaded}>{(data) => <BreakdownList data={data} />}</Show>
    </AdminCard>
  );
}

async function Ideas({ q, status }: { q: AdminQuery; status: FeatureRequestStatus | null }) {
  const [rows, counts, t] = await Promise.all([
    safe("feature requests", () => loadFeatureRequests(status, q.view.internal)),
    safe("feature request counts", () => featureRequestCounts(q)),
    getTranslations("admin.feedback"),
  ]);
  return (
    <AdminCard title={t("ideasTitle")} description={t("ideasDescription")}>
      <Show loaded={counts}>{(data) => <BreakdownList data={data} max={5} />}</Show>
      <Show loaded={rows}>
        {(ideas) =>
          ideas.length === 0 ? (
            <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {ideas.map((row) => (
                <FeatureRequestRowView key={row.id} row={row} />
              ))}
            </ul>
          )
        }
      </Show>
    </AdminCard>
  );
}
