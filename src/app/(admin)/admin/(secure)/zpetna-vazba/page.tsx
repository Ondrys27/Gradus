import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SearchIcon } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { AdminViewLink } from "@/features/admin/ui/admin-view";
import { ReportStatusSelect } from "@/features/admin/ui/report-status";
import type { Tone } from "@/components/ui/tone";
import { isErrorCode, normalizeErrorCodeQuery } from "@/features/errors/error-code";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_PATH } from "@/features/admin/access";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { loadErrorEvent } from "@/features/admin/server/error-alerts-data";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import { peopleNamer } from "@/features/admin/server/people";
import {
  countNewBugReports,
  featureRequestCounts,
  jarvisAnswerRatings,
  loadBugReport,
  loadBugReports,
  reportScreenshotUrl,
  type BugReportFilters,
  loadFeatureRequests,
  loadSatisfactionAnswers,
  loadSatisfactionSummary,
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
import { parseAdminView, serializeAdminView, viewQuery } from "@/features/admin/view-state";
import {
  BUG_REPORT_KINDS,
  BUG_REPORT_SOURCES,
  BUG_REPORT_STATUSES,
  FEATURE_REQUEST_STATUSES,
  type BugReportKind,
  type BugReportRow,
  type BugReportStatus,
  type FeatureRequestStatus,
} from "@/features/admin/types";
import type { AdminRole } from "@/features/admin/roles";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.feedback");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function isStatus(value: string | undefined): value is FeatureRequestStatus {
  return (FEATURE_REQUEST_STATUSES as readonly string[]).includes(value ?? "");
}

function pick<T extends string>(values: readonly T[], raw: string | undefined): T | null {
  return values.includes(raw as T) ? (raw as T) : null;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AdminFeedbackPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "feedback");
  const params = await searchParams;
  const q = adminQuery(params, "feedback");
  const rawStatus = first(params.status);
  const status = isStatus(rawStatus) ? rawStatus : null;
  const rawCode = first(params.code)?.trim() ?? "";
  // A search by error code is a search among the reports.
  const tab: "overview" | "reports" =
    first(params.tab) === "reports" || rawCode ? "reports" : "overview";
  const filters: BugReportFilters = {
    status: pick(BUG_REPORT_STATUSES, first(params.reportStatus)),
    kind: pick(BUG_REPORT_KINDS, first(params.kind)),
    source: pick(BUG_REPORT_SOURCES, first(params.source)),
  };
  const rawReport = first(params.report);
  const reportId = rawReport && /^[0-9a-f-]{36}$/i.test(rawReport) ? rawReport : null;
  const kept = serializeAdminView(parseAdminView(params));
  const query = viewQuery(parseAdminView(params));
  const t = await getTranslations("admin.feedback");
  const newReports = await safe("new bug reports", () => countNewBugReports(q));

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

  const waiting = newReports.ok ? newReports.data : 0;
  const tabs = (
    <nav aria-label={t("tabs")} className="flex gap-1">
      {(["overview", "reports"] as const).map((value) => {
        const active = value === tab;
        return (
          <AdminViewLink
            key={value}
            href={`${ADMIN_PATH}/zpetna-vazba${value === "reports" ? "?tab=reports" : ""}${
              query ? `${value === "reports" ? "&" : "?"}${query.slice(1)}` : ""
            }`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8",
              active
                ? "border-violet font-medium text-ink"
                : "border-transparent text-ink-soft hover:text-ink",
            )}
          >
            {t(`tab.${value}`)}
            {value === "reports" && waiting > 0 && (
              <span className="rounded-full bg-pink/20 px-1.5 text-xs text-pink">{waiting}</span>
            )}
          </AdminViewLink>
        );
      })}
    </nav>
  );

  return (
    <>
      <AdminPageHeader
        section="feedback"
        q={q}
        extra={
          <div className="flex flex-col gap-2">
            {search}
            {tabs}
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        {tab === "reports" ? (
          <>
            <Suspense fallback={null}>
              <ErrorEventCard rawCode={rawCode} />
            </Suspense>
            {reportId && (
              <Suspense fallback={<CardSkeleton height={320} />}>
                <ReportDetail q={q} id={reportId} role={context.role} />
              </Suspense>
            )}
            <Suspense fallback={<CardSkeleton height={240} />}>
              <BugReports
                q={q}
                rawCode={rawCode}
                filters={filters}
                selected={reportId}
                query={query}
                kept={[...kept]}
              />
            </Suspense>
          </>
        ) : (
          <>
            <Suspense fallback={<FiguresSkeleton count={2} />}>
              <Satisfaction q={q} />
            </Suspense>
            <Suspense fallback={<GridSkeleton count={2} height={200} />}>
              <Voices q={q} />
            </Suspense>
            <Suspense fallback={<CardSkeleton height={320} />}>
              <Ideas q={q} status={status} />
            </Suspense>
          </>
        )}
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

/**
 * The record of the error a full code names (error_events): what the e-mail
 * about it said, for the link in that e-mail. Nothing when there is none.
 */
async function ErrorEventCard({ rawCode }: { rawCode: string }) {
  const code = normalizeErrorCodeQuery(rawCode);
  if (!code || !isErrorCode(code)) return null;
  const loaded = await safe("error event", () => loadErrorEvent(code));
  if (!loaded.ok || !loaded.data) return null;
  const row = loaded.data;
  const [t, tControls, nameOf] = await Promise.all([
    getTranslations("admin.feedback"),
    getTranslations("admin.controls"),
    peopleNamer([row.userId]),
  ]);
  const device =
    row.device && tControls.has(`segmentValues.device.${row.device}`)
      ? tControls(`segmentValues.device.${row.device}`)
      : null;
  const browser =
    row.browser && t.has(`browser.${row.browser}`) ? t(`browser.${row.browser}`) : null;
  const source = t.has(`event.source.${row.source}`) ? t(`event.source.${row.source}`) : row.source;
  const details: [string, string | null][] = [
    [t("event.time"), formatDateTime(new Date(row.createdAt), ADMIN_FORMAT_SETTINGS)],
    [t("pageLabel"), row.page],
    [t("event.action"), [source, row.action].filter(Boolean).join(" · ")],
    [t("errorLabel"), row.message],
    [t("event.user"), row.userId ? nameOf(row.userId) : t("anonymous")],
    [t("browserLabel"), [browser, device, row.viewport].filter(Boolean).join(" · ") || null],
    [t("versionLabel"), row.version],
    [t("digestLabel"), row.digest],
    [t("event.count"), t("event.countValue", { count: row.dayCount })],
  ];
  const stack = row.server?.stack ?? row.stack;
  return (
    <AdminCard
      title={t("event.title", { code: row.code })}
      description={t("event.description")}
      wide
    >
      <div className="flex flex-col gap-3" data-testid="error-event">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {details
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="min-w-0 break-words text-ink-soft">{value}</dd>
              </div>
            ))}
          {row.server && (
            <div className="contents">
              <dt className="text-ink-muted">{t("event.serverMessage")}</dt>
              <dd className="min-w-0 break-words text-ink-soft">{row.server.message}</dd>
            </div>
          )}
        </dl>
        {stack && (
          <pre className="max-h-64 overflow-auto rounded-xl border border-line bg-canvas/60 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-ink-soft">
            {stack}
          </pre>
        )}
      </div>
    </AdminCard>
  );
}

const KIND_TONE: Record<BugReportKind, Tone> = { bug: "pink", idea: "teal", confusing: "gold" };

function reportsHref(
  query: string,
  filters: BugReportFilters,
  rawCode: string,
  report?: string,
): string {
  const parts = ["tab=reports"];
  if (rawCode) parts.push(`code=${encodeURIComponent(rawCode)}`);
  if (filters.status) parts.push(`reportStatus=${filters.status}`);
  if (filters.kind) parts.push(`kind=${filters.kind}`);
  if (filters.source) parts.push(`source=${filters.source}`);
  if (report) parts.push(`report=${report}`);
  return `${ADMIN_PATH}/zpetna-vazba?${parts.join("&")}${query ? `&${query.slice(1)}` : ""}`;
}

const selectClass =
  "h-10 rounded-lg border border-line bg-canvas px-2 text-sm text-ink outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-9";

/** Bug reports, newest first, with filters, or the ones a code search finds. */
async function BugReports({
  q,
  rawCode,
  filters,
  selected,
  query,
  kept,
}: {
  q: AdminQuery;
  rawCode: string;
  filters: BugReportFilters;
  selected: string | null;
  query: string;
  kept: [string, string][];
}) {
  const code = normalizeErrorCodeQuery(rawCode);
  const invalid = Boolean(rawCode) && !code;
  const [rows, t, tControls] = await Promise.all([
    invalid ? null : safe("bug reports", () => loadBugReports(q, code, filters)),
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
      <form
        action={`${ADMIN_PATH}/zpetna-vazba`}
        className="mb-3 flex flex-wrap items-end gap-2"
        data-testid="report-filters"
      >
        <input type="hidden" name="tab" value="reports" />
        {rawCode && <input type="hidden" name="code" value={rawCode} />}
        {kept.map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t("filter.status")}
          <select name="reportStatus" defaultValue={filters.status ?? ""} className={selectClass}>
            <option value="">{t("filter.all")}</option>
            {BUG_REPORT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`reportStatus.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t("filter.kind")}
          <select name="kind" defaultValue={filters.kind ?? ""} className={selectClass}>
            <option value="">{t("filter.all")}</option>
            {BUG_REPORT_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`reportKind.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t("filter.source")}
          <select name="source" defaultValue={filters.source ?? ""} className={selectClass}>
            <option value="">{t("filter.all")}</option>
            {BUG_REPORT_SOURCES.map((value) => (
              <option key={value} value={value}>
                {t(`reportSource.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-10 cursor-pointer rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-9"
        >
          {t("filter.apply")}
        </button>
      </form>
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
                    selected={row.id === selected}
                    href={reportsHref(query, filters, rawCode, row.id)}
                    statusLabel={t(`reportStatus.${row.status}`)}
                    kindLabel={t(`reportKind.${row.kind}`)}
                    openLabel={t("openReport")}
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
  selected,
  href,
  statusLabel,
  kindLabel,
  openLabel,
  meta,
  noDescription,
  labels,
  browser,
}: {
  row: BugReportRow;
  selected: boolean;
  href: string;
  statusLabel: string;
  kindLabel: string;
  openLabel: string;
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
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border px-3.5 py-3",
        selected ? "border-violet/60 bg-violet/10" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusPill tone={KIND_TONE[row.kind]} className="h-5 px-2">
            {kindLabel}
          </StatusPill>
          {row.code && (
            <code className="font-mono text-sm font-semibold text-ink select-all">{row.code}</code>
          )}
        </div>
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">{meta}</p>
        <AdminViewLink
          href={href}
          className="inline-flex h-10 items-center text-xs text-violet underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-7"
        >
          {openLabel}
        </AdminViewLink>
      </div>
    </li>
  );
}

/** One report in full: the text, the technical data, the console and (the owner) the screenshot. */
async function ReportDetail({ q, id, role }: { q: AdminQuery; id: string; role: AdminRole }) {
  const loaded = await safe("bug report", () => loadBugReport(q, id));
  const [t, tControls] = await Promise.all([
    getTranslations("admin.feedback"),
    getTranslations("admin.controls"),
  ]);
  if (!loaded.ok) {
    return (
      <AdminCard title={t("detailTitle")} wide>
        <Show loaded={loaded}>{() => null}</Show>
      </AdminCard>
    );
  }
  const row = loaded.data;
  if (!row) {
    return (
      <AdminCard title={t("detailTitle")} wide>
        <AdminEmpty hint={t("detailMissing")} />
      </AdminCard>
    );
  }
  // The picture is the owner's and the author's: an admin sees only that there is one.
  const shot =
    row.screenshotPath && role === "owner" ? await reportScreenshotUrl(row.screenshotPath) : null;
  const nameOf = await peopleNamer([row.userId]);
  const device =
    row.device && tControls.has(`segmentValues.device.${row.device}`)
      ? tControls(`segmentValues.device.${row.device}`)
      : null;
  const browser =
    row.browser && t.has(`browser.${row.browser}`) ? t(`browser.${row.browser}`) : null;
  const details: [string, string | null][] = [
    [t("detail.kind"), t(`reportKind.${row.kind}`)],
    [t("detail.source"), t(`reportSource.${row.source}`)],
    [t("detail.from"), row.userId ? nameOf(row.userId) : t("anonymous")],
    [t("detail.sent"), formatDateTime(new Date(row.createdAt), ADMIN_FORMAT_SETTINGS)],
    [t("pageLabel"), row.page],
    [t("browserLabel"), [browser, device, row.viewport].filter(Boolean).join(" · ") || null],
    [t("detail.language"), row.locale],
    [t("versionLabel"), row.version],
    [t("errorLabel"), row.message],
    [t("digestLabel"), row.digest],
    [t("detail.code"), row.code],
  ];
  return (
    <AdminCard title={t("detailTitle")} description={row.code ?? undefined} wide>
      <div className="flex flex-col gap-4" data-testid="report-detail">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div>
              <p className="micro-label">{t("detail.what")}</p>
              <p className="text-sm whitespace-pre-wrap text-ink">
                {row.description ?? t("noDescription")}
              </p>
            </div>
            {row.expected && (
              <div>
                <p className="micro-label">{t("detail.expected")}</p>
                <p className="text-sm whitespace-pre-wrap text-ink">{row.expected}</p>
              </div>
            )}
          </div>
          <ReportStatusSelect id={row.id} status={row.status} />
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {details
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="min-w-0 break-words text-ink-soft">{value}</dd>
              </div>
            ))}
        </dl>
        <div>
          <p className="micro-label">{t("detail.console", { count: row.consoleErrors.length })}</p>
          {row.consoleErrors.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("detail.consoleEmpty")}</p>
          ) : (
            <pre
              data-testid="report-console"
              className="max-h-64 overflow-auto rounded-xl border border-line bg-canvas/60 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-ink-soft"
            >
              {row.consoleErrors
                .map((line) => `${line.at.slice(11, 19)} [${line.kind}] ${line.message}`)
                .join("\n")}
            </pre>
          )}
        </div>
        {row.screenshotPath && (
          <div>
            <p className="micro-label">{t("detail.screenshot")}</p>
            {shot ? (
              // A signed link to the person's own screen: next/image has nothing to optimise.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shot}
                alt={t("detail.screenshot")}
                data-testid="report-screenshot"
                className="mt-1 max-h-[32rem] w-full rounded-xl border border-line object-contain object-top"
              />
            ) : (
              <p className="text-sm text-ink-muted">
                {role === "owner" ? t("detail.screenshotGone") : t("detail.screenshotOwnerOnly")}
              </p>
            )}
          </div>
        )}
      </div>
    </AdminCard>
  );
}

async function Satisfaction({ q }: { q: AdminQuery }) {
  const loaded = await safe("satisfaction summary", () => loadSatisfactionSummary(q));
  return (
    <Show loaded={loaded}>
      {(summary) => (
        <Figures
          tiles={[
            { key: "satisfaction_avg", unit: "count", value: summary.average },
            { key: "satisfaction", unit: "count", value: summary.responses },
          ]}
        />
      )}
    </Show>
  );
}

/** What people wrote in the satisfaction survey, its spread, and how they rate Jarvis's answers. */
async function Voices({ q }: { q: AdminQuery }) {
  const [answers, summary, ratings, t, tSpread, tRatings] = await Promise.all([
    safe("satisfaction answers", () => loadSatisfactionAnswers(q)),
    safe("satisfaction spread", () => loadSatisfactionSummary(q)),
    safe("jarvis answer ratings", () => jarvisAnswerRatings(q)),
    getTranslations("admin.feedback"),
    getTranslations("metrics.items.satisfaction"),
    getTranslations("metrics.items.jarvis_answer_ratings"),
  ]);
  return (
    <BlockGrid>
      <AdminCard title={t("answersTitle")} description={t("answersDescription")} wide>
        <Show loaded={answers}>
          {(rows) =>
            rows.length === 0 ? (
              <AdminEmpty hint={t("noAnswers")} />
            ) : (
              <ul className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
                {rows.map((row, index) => (
                  <li
                    key={index}
                    className="flex flex-col gap-1.5 rounded-xl border border-line px-3.5 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                      <span>
                        {t("satisfactionBadge", { score: row.satisfaction })} · {row.userName}
                      </span>
                      <span>
                        {formatCalendarDate(row.createdAt.slice(0, 10), ADMIN_FORMAT_SETTINGS)}
                      </span>
                    </div>
                    {row.liked && (
                      <p className="text-sm text-ink">
                        <span className="text-ink-muted">{t("liked")}: </span>
                        {row.liked}
                      </p>
                    )}
                    {row.improve && (
                      <p className="text-sm text-ink">
                        <span className="text-ink-muted">{t("improve")}: </span>
                        {row.improve}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )
          }
        </Show>
      </AdminCard>
      <AdminCard title={tSpread("name")} description={tSpread("description")}>
        <Show loaded={summary}>{(data) => <BreakdownList data={data.distribution} />}</Show>
      </AdminCard>
      <AdminCard title={tRatings("name")} description={tRatings("description")}>
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
