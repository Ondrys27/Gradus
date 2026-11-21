import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StatusPill } from "@/components/ui/status-pill";
import type { Tone } from "@/components/ui/tone";
import { ADMIN_PATH } from "@/features/admin/access";
import {
  cameBack,
  ERROR_GROUP_STATUSES,
  ERROR_LOG_PAGE_SIZE,
  ERROR_LOG_TABS,
  errorLogSearch,
  parseErrorLogFilters,
  type ErrorGroupStatus,
  type ErrorLogFilters,
} from "@/features/admin/error-log";
import { ADMIN_FORMAT_SETTINGS } from "@/features/admin/format-metric";
import { adminCan, type AdminActor } from "@/features/admin/roles";
import { logAdminAction } from "@/features/admin/server/audit";
import { loadErrorAlerts } from "@/features/admin/server/error-alerts-data";
import { loadErrorGroup, loadErrorGroups } from "@/features/admin/server/error-log-data";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery, safe, type AdminQuery } from "@/features/admin/server/metrics-data";
import { peopleNamer } from "@/features/admin/server/people";
import { AdminPageHeader, Show } from "@/features/admin/ui/admin-page";
import { AdminViewLink } from "@/features/admin/ui/admin-view";
import { AdminCard, AdminEmpty, CardSkeleton } from "@/features/admin/ui/blocks";
import { ErrorAlertsForm } from "@/features/admin/ui/error-alerts-form";
import { ErrorStatusButtons, PeerNoticesSwitch } from "@/features/admin/ui/error-log-controls";
import { ServerPager, ServerTable } from "@/features/admin/ui/server-table";
import { UserDetailLink } from "@/features/admin/ui/user-link";
import { parseAdminView, viewQuery } from "@/features/admin/view-state";
import {
  DIGEST_HOUR_UTC,
  ERROR_ALERT_LIMITS,
  MAX_ALERT_EMAILS,
} from "@/features/errors/alerts/settings";
import { formatDateTime, formatNumber } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.errors");
  return { title: t("title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const PATH = `${ADMIN_PATH}/chyby`;
const when = (iso: string | null) => (iso ? formatDateTime(new Date(iso), ADMIN_FORMAT_SETTINGS) : "–");
const count = (value: number) => formatNumber(value, {}, ADMIN_FORMAT_SETTINGS);

const STATUS_TONE: Record<ErrorGroupStatus, Tone> = {
  new: "pink",
  in_progress: "gold",
  resolved: "green",
  ignored: "neutral",
};

const selectClass =
  "h-11 rounded-lg border border-line bg-canvas px-2 text-sm text-ink outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-9";

/**
 * Operations → Errors (step 27.2): every caught error grouped by its
 * fingerprint, with a state, and the e-mails about errors as the second
 * tab. Everyone in the administration triages; the e-mail settings change
 * only the owner and a full admin. Technical data only, never what a user
 * had on the screen.
 */
export default async function AdminErrorsPage({ searchParams }: Props) {
  const context = await requireAdmin();
  const params = await searchParams;
  const filters = parseErrorLogFilters(params);
  await logAdminAction(context, "view", filters.tab === "alerts" ? "errors.alerts" : "errors");
  const q = adminQuery(params, "errors");
  const kept = viewQuery(parseAdminView(params));
  const t = await getTranslations("admin.errors");

  const tabs = (
    <nav aria-label={t("tabs")} className="flex gap-1">
      {ERROR_LOG_TABS.map((value) => {
        const active = value === filters.tab;
        return (
          <AdminViewLink
            key={value}
            href={`${PATH}${errorLogSearch({ tab: value }, kept)}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8",
              active ? "border-violet font-medium text-ink" : "border-transparent text-ink-soft hover:text-ink",
            )}
          >
            {t(`tab.${value}`)}
          </AdminViewLink>
        );
      })}
    </nav>
  );

  return (
    <>
      <AdminPageHeader section="errors" q={q} extra={tabs} />
      {filters.tab === "alerts" ? (
        <Suspense fallback={<CardSkeleton height={420} />}>
          <AlertsTab actor={context} userId={context.userId} />
        </Suspense>
      ) : (
        <div className="flex flex-col gap-4">
          <SearchForm filters={filters} kept={kept} />
          {filters.group && (
            <Suspense fallback={<CardSkeleton height={320} />}>
              <GroupDetail fingerprint={filters.group} />
            </Suspense>
          )}
          <Suspense fallback={<CardSkeleton height={420} />}>
            <GroupList q={q} filters={filters} kept={kept} />
          </Suspense>
        </div>
      )}
    </>
  );
}

/** A plain GET form: works before the scripts load, and the address keeps the search. */
async function SearchForm({ filters, kept }: { filters: ErrorLogFilters; kept: string }) {
  const t = await getTranslations("admin.errors");
  const hidden = [...new URLSearchParams(kept.replace(/^\?/, ""))];
  return (
    <form
      method="get"
      action={PATH}
      id="error-search"
      className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-4"
    >
      {hidden.map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-ink-muted">
        {t("filters.code")}
        <input
          type="search"
          name="code"
          defaultValue={filters.rawCode}
          placeholder="GR-…"
          autoComplete="off"
          data-admin-search
          className="h-11 rounded-lg border border-line bg-canvas px-3 font-mono text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-9"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        {t("filters.status")}
        <select name="status" defaultValue={filters.status ?? ""} className={selectClass}>
          <option value="">{t("filters.anyStatus")}</option>
          {ERROR_GROUP_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`status.${status}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink-soft mouse:min-h-9">
        <input
          type="checkbox"
          name="latest"
          value="1"
          defaultChecked={filters.latest}
          className="size-4 accent-violet"
        />
        {t("filters.latest")}
      </label>
      <button
        type="submit"
        className="inline-flex h-11 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 mouse:h-10"
      >
        {t("filters.submit")}
      </button>
      {(filters.rawCode || filters.status || filters.latest) && (
        <Link
          href={`${PATH}${kept}`}
          prefetch={false}
          className="flex h-11 items-center text-sm text-ink-soft underline-offset-4 hover:underline mouse:h-9"
        >
          {t("filters.clear")}
        </Link>
      )}
    </form>
  );
}

async function GroupList({ q, filters, kept }: { q: AdminQuery; filters: ErrorLogFilters; kept: string }) {
  const invalid = Boolean(filters.rawCode.trim()) && !filters.code;
  const [loaded, t, tFeedback] = await Promise.all([
    invalid ? null : safe("error groups", () => loadErrorGroups(q, filters)),
    getTranslations("admin.errors"),
    getTranslations("admin.feedback"),
  ]);
  if (invalid) {
    return <AdminEmpty title={t("invalidCode")} hint={t("invalidCodeHint")} />;
  }
  return (
    <Show loaded={loaded!}>
      {({ rows, total, version }) => {
        const href = (extra: Partial<ErrorLogFilters>) =>
          `${PATH}${errorLogSearch({ ...filters, ...extra }, kept)}`;
        return (
          <div className="flex flex-col gap-3" id="error-log" data-testid="error-log">
            <p className="text-xs text-ink-muted">
              {t("summary", { count: total })}
              {filters.latest ? ` · ${t("versionNote", { version })}` : ""}
              {filters.code ? ` · ${t("codeNote")}` : ""}
            </p>
            {rows.length === 0 ? (
              <AdminEmpty title={t("emptyTitle")} hint={t("emptyHint")} />
            ) : (
              <ServerTable
                caption={t("title")}
                minWidth="60rem"
                columns={[
                  { key: "code", label: t("columns.code") },
                  { key: "message", label: t("columns.message") },
                  { key: "where", label: t("columns.where") },
                  { key: "count", label: t("columns.count"), align: "right" },
                  { key: "users", label: t("columns.users"), align: "right" },
                  { key: "seen", label: t("columns.seen") },
                  { key: "version", label: t("columns.version") },
                  { key: "status", label: t("columns.status") },
                ]}
                rows={rows.map((row) => {
                  const source = tFeedback.has(`event.source.${row.source}`)
                    ? tFeedback(`event.source.${row.source}`)
                    : row.source;
                  return {
                    key: row.fingerprint,
                    cells: [
                      <span key="code" className="font-mono text-xs text-ink">
                        {row.lastCode}
                      </span>,
                      <AdminViewLink
                        key="message"
                        href={href({ group: row.fingerprint })}
                        className="line-clamp-2 max-w-md text-ink underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-violet/40"
                        data-testid="error-group-link"
                      >
                        {row.message}
                      </AdminViewLink>,
                      <span key="where" className="flex flex-col text-xs">
                        <span className="font-mono text-ink-soft">{row.page}</span>
                        <span className="text-ink-muted">{[source, row.action].filter(Boolean).join(" · ")}</span>
                      </span>,
                      <span key="count" className="tabular-nums">
                        {count(row.occurrences)}
                      </span>,
                      <span key="users" className="tabular-nums">
                        {count(row.users)}
                      </span>,
                      <span key="seen" className="flex flex-col text-xs tabular-nums">
                        <span className="text-ink">{t("lastAt", { at: when(row.lastAt) })}</span>
                        <span className="text-ink-muted">{t("firstAt", { at: when(row.firstAt) })}</span>
                      </span>,
                      <span key="version" className="font-mono text-xs text-ink-soft">
                        {row.lastVersion ?? "–"}
                      </span>,
                      <span key="status" className="flex flex-wrap gap-1">
                        <StatusPill tone={STATUS_TONE[row.status]}>{t(`status.${row.status}`)}</StatusPill>
                        {cameBack(row.status, row.returnedAt) && (
                          <StatusPill tone="violet">{t("cameBack")}</StatusPill>
                        )}
                      </span>,
                    ],
                  };
                })}
              />
            )}
            <ServerPager
              page={filters.page}
              hasMore={(filters.page + 1) * ERROR_LOG_PAGE_SIZE < total}
              hrefFor={(page) => href({ page, group: null })}
              labels={{
                pagination: t("pagination"),
                newer: t("newer"),
                older: t("older"),
                page: t("page", { page: filters.page + 1 }),
              }}
            />
          </div>
        );
      }}
    </Show>
  );
}

/** One error: its state, its occurrences, the e-mails about it and the reports filed with its codes. */
async function GroupDetail({ fingerprint }: { fingerprint: string }) {
  const [loaded, t, tFeedback, tControls] = await Promise.all([
    safe("error group", () => loadErrorGroup(fingerprint)),
    getTranslations("admin.errors"),
    getTranslations("admin.feedback"),
    getTranslations("admin.controls"),
  ]);
  if (!loaded.ok) {
    return (
      <AdminCard title={t("detail.title")} wide>
        <Show loaded={loaded}>{() => null}</Show>
      </AdminCard>
    );
  }
  const group = loaded.data;
  if (!group) {
    return (
      <AdminCard title={t("detail.title")} wide>
        <AdminEmpty hint={t("detail.missing")} />
      </AdminCard>
    );
  }
  const browser = (value: string | null) =>
    value && tFeedback.has(`browser.${value}`) ? tFeedback(`browser.${value}`) : value;
  const device = (value: string | null) =>
    value && tControls.has(`segmentValues.device.${value}`) ? tControls(`segmentValues.device.${value}`) : null;

  return (
    <AdminCard
      title={group.message}
      description={
        group.updatedBy
          ? t("detail.changedBy", { name: group.updatedBy, date: when(group.updatedAt) })
          : t("detail.description")
      }
      actions={
        cameBack(group.status, group.returnedAt) ? (
          <StatusPill tone="violet">{t("cameBackAt", { at: when(group.returnedAt) })}</StatusPill>
        ) : undefined
      }
      wide
      id="error-group"
    >
      <div className="flex flex-col gap-5" data-testid="error-group">
        <ErrorStatusButtons key={`${fingerprint}-${group.status}`} fingerprint={fingerprint} status={group.status} />

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-muted">
            {t("detail.occurrences", { count: group.occurrences.length })}
          </h3>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {group.occurrences.map((occurrence) => (
              <li key={occurrence.code} className="flex flex-col gap-1 px-3 py-2 text-sm" data-testid="error-occurrence">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex flex-wrap items-center gap-x-3">
                    <span className="text-ink tabular-nums">{when(occurrence.createdAt)}</span>
                    <span className="font-mono text-xs text-ink-soft">{occurrence.code}</span>
                  </span>
                  <span className="text-xs text-ink-muted">
                    {[browser(occurrence.browser), device(occurrence.device), occurrence.viewport, occurrence.version]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
                  {occurrence.userId ? (
                    <>
                      <span>{occurrence.userName}</span>
                      <UserDetailLink userId={occurrence.userId} label={t("detail.openUser")} />
                    </>
                  ) : (
                    <span>{t("detail.anonymous")}</span>
                  )}
                  <span className="font-mono text-ink-muted">{occurrence.page}</span>
                </div>
                {occurrence.stack && (
                  <details className="group">
                    <summary className="flex min-h-10 cursor-pointer items-center text-xs text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-7">
                      {t("detail.stack")}
                    </summary>
                    <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-canvas/60 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-ink-soft">
                      {occurrence.stack}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-muted">{t("detail.sends")}</h3>
          {group.sends.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("detail.noSends")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" data-testid="error-sends">
              {group.sends.map((send) => (
                <li key={`${send.createdAt}-${send.kind}`} className="flex flex-wrap justify-between gap-x-3">
                  <span className="text-ink tabular-nums">{when(send.sentAt ?? send.createdAt)}</span>
                  <span className="text-ink-soft">
                    {send.to?.length ? send.to.join(", ") : t("detail.recipients", { count: send.recipients })}
                    {" · "}
                    {t(`detail.sendStatus.${send.status === "failed" ? "failed" : send.status === "sent" ? "sent" : "pending"}`)}
                    {send.mock ? ` · ${t("detail.mock")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-muted">{t("detail.reports")}</h3>
          {group.reports.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("detail.noReports")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {group.reports.map((report) => (
                <li key={report.id} className="flex flex-wrap items-center justify-between gap-x-3">
                  <Link
                    href={`${ADMIN_PATH}/zpetna-vazba?tab=reports&report=${report.id}`}
                    prefetch={false}
                    className="font-mono text-xs text-violet underline-offset-4 hover:underline"
                  >
                    {report.code}
                  </Link>
                  <span className="text-ink-soft">
                    {when(report.createdAt)}
                    {" · "}
                    {tFeedback.has(`status.${report.status}`) ? tFeedback(`status.${report.status}`) : report.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AdminCard>
  );
}

/** The e-mails about errors (as in step 16.2) and one's own "X changed …" switch. */
async function AlertsTab({ actor, userId }: { actor: AdminActor; userId: string }) {
  const [data, t, tErrors] = await Promise.all([
    loadErrorAlerts(),
    getTranslations("admin.errorAlerts"),
    getTranslations("admin.errors"),
  ]);
  const canEdit = adminCan(actor, "editErrorAlerts");
  const peers = adminCan(actor, "peerNotices");
  const [nameOf, prefs] = await Promise.all([
    peopleNamer([data.updatedBy]),
    peers
      ? createAdminClient()
          .from("admin_notify_prefs")
          .select("peer_changes")
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const updated =
    data.updatedAt && data.stored
      ? t("updated", {
          date: when(data.updatedAt),
          name: data.updatedBy ? nameOf(data.updatedBy) : t("unknownPerson"),
        })
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="note"
        data-testid="error-alerts-sender"
        className={
          data.testSender
            ? "rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-pretty text-ink"
            : "rounded-xl border border-line bg-surface px-4 py-3 text-sm text-pretty text-ink-soft"
        }
      >
        {data.testSender ? t("senderWarning") : t("senderNote", { sender: data.sender })}
      </div>
      <AdminCard
        id="error-alerts"
        title={t("cardTitle")}
        description={t("cardDescription", {
          minutes: ERROR_ALERT_LIMITS.fingerprintMinutes,
          perHour: ERROR_ALERT_LIMITS.perHour,
        })}
        wide
      >
        <ErrorAlertsForm
          saved={data.settings}
          readOnly={!canEdit}
          maxEmails={MAX_ALERT_EMAILS}
          digestHourUtc={DIGEST_HOUR_UTC}
          updated={updated}
        />
      </AdminCard>
      {peers && (
        <AdminCard id="peer-notices" title={tErrors("peer.title")} description={tErrors("peer.description")} wide>
          <PeerNoticesSwitch enabled={prefs.data?.peer_changes ?? true} />
        </AdminCard>
      )}
    </div>
  );
}
