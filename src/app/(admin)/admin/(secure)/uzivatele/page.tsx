import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SearchIcon } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import { ADMIN_PATH } from "@/features/admin/access";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "@/features/admin/format-metric";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminQuery } from "@/features/admin/server/metrics-data";
import { parseAdminView, serializeAdminView } from "@/features/admin/view-state";
import { loadUsers, USER_SORTS, type UserSort } from "@/features/admin/server/users-data";
import { peopleNamer } from "@/features/admin/server/people";
import { AdminPageHeader } from "@/features/admin/ui/admin-page";
import { AdminEmpty } from "@/features/admin/ui/blocks";
import { ServerPager, ServerTable, type ServerColumn } from "@/features/admin/ui/server-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.users");
  return { title: t("title") };
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function isSort(value: string): value is UserSort {
  return (USER_SORTS as readonly string[]).includes(value);
}

/** Which column each sort orders by; a click on the heading sorts. */
const SORT_COLUMN: Record<UserSort, string> = {
  activity: "lastActive",
  cost: "aiCost",
  signup: "signedUp",
};

/**
 * The accounts as a list. The search field sits in the sticky bar (`/`
 * jumps to it); the list is the content, so there are no tiles — the
 * numbers about users are on Growth. Changing an account (internal,
 * AI cap) is in its detail.
 */
export default async function AdminUsersPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "users");
  const params = await searchParams;
  const query = first(params.q);
  const sort = isSort(first(params.sort)) ? (first(params.sort) as UserSort) : "activity";
  const page = Math.max(0, Number.parseInt(first(params.page) || "0", 10) || 0);
  // The filters this page offers apply; the whole view stays in every link.
  const q = adminQuery(params, "users");
  const { view } = q;
  const kept = serializeAdminView(parseAdminView(params));

  const [{ rows, hasMore }, t, tUnits, tControls] = await Promise.all([
    loadUsers({ view, query, sort, page }),
    getTranslations("admin.users"),
    getTranslations("admin.units"),
    getTranslations("admin.controls"),
  ]);
  const nameOf = await peopleNamer(rows.map((row) => row.userId));
  const planLabel = (plan: string) =>
    tControls.has(`segmentValues.plan.${plan}`) ? tControls(`segmentValues.plan.${plan}`) : plan;
  const statusLabel = (status: string) => (t.has(`status.${status}`) ? t(`status.${status}`) : status);
  const roleLabel = (role: string | null) =>
    role && tControls.has(`segmentValues.role.${role}`) ? tControls(`segmentValues.role.${role}`) : "–";

  const linkFor = (next: { sort?: UserSort; page?: number }) => {
    const p = new URLSearchParams(kept);
    if (query) p.set("q", query);
    p.set("sort", next.sort ?? sort);
    if (next.page) p.set("page", String(next.page));
    return `${ADMIN_PATH}/uzivatele?${p.toString()}`;
  };
  const sortColumn = (key: UserSort): Pick<ServerColumn, "sortHref" | "sorted"> => ({
    sortHref: linkFor({ sort: key }),
    sorted: sort === key ? "desc" : null,
  });

  const columns: ServerColumn[] = [
    { key: "user", label: t("columns.user") },
    { key: "plan", label: t("columns.plan") },
    { key: "status", label: t("columns.status") },
    { key: "role", label: t("columns.role") },
    { key: SORT_COLUMN.signup, label: t("columns.signedUp"), ...sortColumn("signup") },
    { key: SORT_COLUMN.activity, label: t("columns.lastActive"), ...sortColumn("activity") },
    { key: SORT_COLUMN.cost, label: t("columns.aiCost"), align: "right", ...sortColumn("cost") },
  ];

  const search = (
    <form className="relative max-w-sm" action={`${ADMIN_PATH}/uzivatele`} role="search">
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
      />
      <input type="hidden" name="sort" value={sort} />
      {[...kept].map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <input
        type="search"
        name="q"
        defaultValue={query}
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchPlaceholder")}
        data-admin-search
        className="h-10 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/30 mouse:h-9"
      />
    </form>
  );

  return (
    <>
      <AdminPageHeader section="users" q={q} extra={search} />
      <div className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <AdminEmpty title={t("emptyTitle")} hint={t("emptyDescription")} />
        ) : (
          <ServerTable
            columns={columns}
            minWidth="56rem"
            caption={t("title")}
            rows={rows.map((row) => ({
              key: row.userId,
              cells: [
                <span key="name" className="flex items-center gap-2">
                  <Link
                    href={`${ADMIN_PATH}/uzivatele/${row.userId}${kept.size ? `?${kept}` : ""}`}
                    prefetch={false}
                    className="max-w-64 truncate font-medium text-ink underline-offset-2 hover:text-violet hover:underline"
                  >
                    {nameOf(row.userId)}
                  </Link>
                  {row.isInternal && (
                    <StatusPill tone="neutral" className="h-5 px-2 text-xs">
                      {t("internal")}
                    </StatusPill>
                  )}
                </span>,
                planLabel(row.plan),
                statusLabel(row.status),
                roleLabel(row.role),
                <span key="signed" className="tabular-nums">
                  {formatCalendarDate(row.signedUpAt.slice(0, 10), ADMIN_FORMAT_SETTINGS)}
                </span>,
                <span key="active" className="tabular-nums">
                  {row.lastActiveAt
                    ? formatDateTime(new Date(row.lastActiveAt), ADMIN_FORMAT_SETTINGS)
                    : "–"}
                </span>,
                formatMetricValue(row.aiCostUsd, "usd", tUnits),
              ],
            }))}
          />
        )}
        <ServerPager
          page={page}
          hasMore={hasMore}
          hrefFor={(n) => linkFor({ page: n })}
          labels={{
            pagination: t("pagination"),
            newer: t("newer"),
            older: t("older"),
            page: t("page", { page: page + 1 }),
          }}
        />
      </div>
    </>
  );
}
