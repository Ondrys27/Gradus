import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { formatCalendarDate } from "@/lib/format";
import { cn } from "@/lib/utils";
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
import {
  AdminCard,
  AdminEmpty,
  BlockGrid,
  CardSkeleton,
  FiguresSkeleton,
  GridSkeleton,
} from "@/features/admin/ui/blocks";
import { BreakdownList } from "@/features/admin/ui/data-blocks";
import { FeatureRequestRowView } from "@/features/admin/ui/feature-request-row";
import { Figures } from "@/features/admin/ui/metric-tile";
import { FEATURE_REQUEST_STATUSES, type FeatureRequestStatus } from "@/features/admin/types";

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
  const q = adminQuery(params, "feedback");
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = isStatus(rawStatus) ? rawStatus : null;

  return (
    <>
      <AdminPageHeader section="feedback" q={q} />
      <div className="flex flex-col gap-4">
        <Suspense fallback={<FiguresSkeleton count={1} />}>
          <Nps q={q} />
        </Suspense>
        <Suspense fallback={<GridSkeleton count={2} height={200} />}>
          <Voices q={q} />
        </Suspense>
        <Suspense fallback={<CardSkeleton height={320} />}>
          <Ideas q={q} status={status} />
        </Suspense>
      </div>
    </>
  );
}

async function Nps({ q }: { q: AdminQuery }) {
  const loaded = await safe("nps summary", () => loadNpsSummary(q));
  return (
    <Show loaded={loaded}>
      {(summary) => <Figures tiles={[{ key: "nps", unit: "count", value: summary.score }]} />}
    </Show>
  );
}

/** What people wrote: the NPS comments, and how they rate Jarvis's answers. */
async function Voices({ q }: { q: AdminQuery }) {
  const [comments, ratings, t, tItems] = await Promise.all([
    safe("nps comments", () => loadNpsComments(q)),
    safe("jarvis answer ratings", () => jarvisAnswerRatings(q)),
    getTranslations("admin.feedback"),
    getTranslations("metrics.items.jarvis_answer_ratings"),
  ]);
  return (
    <BlockGrid>
      <AdminCard title={t("commentsTitle")} description={t("commentsDescription")}>
        <Show loaded={comments}>
          {(rows) =>
            rows.length === 0 ? (
              <AdminEmpty hint={t("noComments")} />
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
      <AdminCard title={tItems("name")} description={tItems("description")}>
        <Show loaded={ratings}>{(data) => <BreakdownList data={data} />}</Show>
      </AdminCard>
    </BlockGrid>
  );
}

async function Ideas({ q, status }: { q: AdminQuery; status: FeatureRequestStatus | null }) {
  const [rows, counts, t] = await Promise.all([
    safe("feature requests", () => loadFeatureRequests(q, status)),
    safe("feature request counts", () => featureRequestCounts(q)),
    getTranslations("admin.feedback"),
  ]);
  // A failed load keeps its place and says so (Show), like every other block.
  const hasCounts = !counts.ok || counts.data.items.some((item) => (item.value ?? 0) > 0);
  return (
    <AdminCard title={t("ideasTitle")} description={t("ideasDescription")} wide>
      <div
        className={cn(
          "grid grid-cols-1 gap-5",
          hasCounts && "lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]",
        )}
      >
        {hasCounts && (
          <Show loaded={counts}>{(data) => <BreakdownList data={data} max={5} />}</Show>
        )}
        <Show loaded={rows}>
          {(ideas) =>
            ideas.length === 0 ? (
              <AdminEmpty hint={t("emptyDescription")} />
            ) : (
              <ul className="flex flex-col gap-2">
                {ideas.map((row) => (
                  <FeatureRequestRowView key={row.id} row={row} />
                ))}
              </ul>
            )
          }
        </Show>
      </div>
    </AdminCard>
  );
}
