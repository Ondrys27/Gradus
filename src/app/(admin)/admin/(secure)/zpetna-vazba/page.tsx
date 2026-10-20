import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SearchIcon } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import type { Tone } from "@/components/ui/tone";
import { normalizeErrorCodeQuery } from "@/features/errors/error-code";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_PATH } from "@/features/admin/access";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import {
  featureRequestCounts,
  jarvisAnswerRatings,
  loadBugReports,
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
import { parseAdminView, serializeAdminView } from "@/features/admin/view-state";
import {
  FEATURE_REQUEST_STATUSES,
  type BugReportRow,
  type BugReportStatus,
  type FeatureRequestStatus,
} from "@/features/admin/types";

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
  const rawCode = (Array.isArray(params.code) ? params.code[0] : params.code)?.trim() ?? "";
  const kept = serializeAdminView(parseAdminView(params));
  const t = await getTranslations("admin.feedback");

  // The search for an error code sits in the sticky bar (`/` jumps to it).
  const search = (
    <form className="relative max-w-sm" action={`${ADMIN_PATH}/zpetna-vazba`} role="search">
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
      />
      {[...kept].map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {status && <input type="hidden" name="status" value={status} />}
      <input
        type="search"
        name="code"
        defaultValue={rawCode}
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchPlaceholder")}
        autoCapitalize="characters"
        spellCheck={false}
        data-admin-search
        className="h-10 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/30 mouse:h-9"
      />
    </form>
  );

  return (
    <>
      <AdminPageHeader section="feedback" q={q} extra={search} />
      <div className="flex flex-col gap-4">
        <Suspense fallback={<CardSkeleton height={240} />}>
          <BugReports q={q} rawCode={rawCode} />
        </Suspense>
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

const REPORT_STATUS_TONE: Record<BugReportStatus, Tone> = {
  new: "pink",
  in_progress: "gold",
  fixed: "green",
  cannot_reproduce: "neutral",
};

/** Bug reports from the error page, newest first, or the ones a code search finds. */
async function BugReports({ q, rawCode }: { q: AdminQuery; rawCode: string }) {
  const code = normalizeErrorCodeQuery(rawCode);
  const invalid = Boolean(rawCode) && !code;
  const [rows, t, tControls] = await Promise.all([
    invalid ? null : safe("bug reports", () => loadBugReports(q, code)),
    getTranslations("admin.feedback"),
    getTranslations("admin.controls"),
  ]);
  const deviceLabel = (device: string | null) =>
    device && tControls.has(`segmentValues.device.${device}`)
      ? tControls(`segmentValues.device.${device}`)
      : null;
  const browserLabel = (browser: string | null) =>
    browser && t.has(`browser.${browser}`) ? t(`browser.${browser}`) : null;

  return (
    <AdminCard title={t("reportsTitle")} description={t("reportsDescription")} wide>
      {rows === null ? (
        <AdminEmpty hint={t("reportsInvalidCode")} />
      ) : (
        <Show loaded={rows}>
          {(reports) =>
            reports.length === 0 ? (
              <AdminEmpty
                hint={code ? t("reportsNotFound", { code: rawCode }) : t("reportsEmpty")}
              />
            ) : (
              <ul className="flex flex-col gap-2" data-testid="bug-reports">
                {reports.map((row) => (
                  <BugReportItem
                    key={row.id}
                    row={row}
                    statusLabel={t(`reportStatus.${row.status}`)}
                    meta={t("reportMeta", {
                      name: row.userName ?? t("anonymous"),
                      date: formatDateTime(new Date(row.createdAt), ADMIN_FORMAT_SETTINGS),
                    })}
                    noDescription={t("noDescription")}
                    labels={{
                      page: t("pageLabel"),
                      browser: t("browserLabel"),
                      version: t("versionLabel"),
                      error: t("errorLabel"),
                      digest: t("digestLabel"),
                    }}
                    browser={[browserLabel(row.browser), deviceLabel(row.device), row.viewport]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                ))}
              </ul>
            )
          }
        </Show>
      )}
    </AdminCard>
  );
}

function BugReportItem({
  row,
  statusLabel,
  meta,
  noDescription,
  labels,
  browser,
}: {
  row: BugReportRow;
  statusLabel: string;
  meta: string;
  noDescription: string;
  labels: Record<"page" | "browser" | "version" | "error" | "digest", string>;
  browser: string;
}) {
  const details: [string, string | null][] = [
    [labels.page, row.page],
    [labels.browser, browser || null],
    [labels.version, row.version],
    [labels.error, row.message],
    [labels.digest, row.digest],
  ];
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-line px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="font-mono text-sm font-semibold text-ink select-all">
          {row.code ?? "–"}
        </code>
        <StatusPill tone={REPORT_STATUS_TONE[row.status]} className="h-5 px-2">
          {statusLabel}
        </StatusPill>
      </div>
      <p className={cn("text-sm", row.description ? "text-ink" : "text-ink-muted")}>
        {row.description ?? noDescription}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        {details
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="min-w-0 break-words text-ink-soft">{value}</dd>
            </div>
          ))}
      </dl>
      <p className="text-xs text-ink-muted">{meta}</p>
    </li>
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
