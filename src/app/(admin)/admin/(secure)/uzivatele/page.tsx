import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SearchIcon } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowCard } from "@/components/ui/glow-card";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import { ADMIN_PATH } from "@/features/admin/access";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "@/features/admin/format-metric";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { loadUsers, USER_SORTS, type UserSort } from "@/features/admin/server/users-data";
import { InternalToggle } from "@/features/admin/ui/internal-toggle";
import { cn } from "@/lib/utils";

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

export default async function AdminUsersPage({ searchParams }: Props) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "users");
  const params = await searchParams;
  const query = first(params.q);
  const sort = isSort(first(params.sort)) ? (first(params.sort) as UserSort) : "activity";
  const page = Math.max(0, Number.parseInt(first(params.page) || "0", 10) || 0);

  const [{ rows, hasMore }, t, tUnits, tControls] = await Promise.all([
    loadUsers({ query, sort, page }),
    getTranslations("admin.users"),
    getTranslations("admin.units"),
    getTranslations("admin.controls"),
  ]);
  const planLabel = (plan: string) =>
    tControls.has(`segmentValues.plan.${plan}`) ? tControls(`segmentValues.plan.${plan}`) : plan;
  const statusLabel = (status: string) => (t.has(`status.${status}`) ? t(`status.${status}`) : status);
  const roleLabel = (role: string | null) =>
    role && tControls.has(`segmentValues.role.${role}`) ? tControls(`segmentValues.role.${role}`) : "–";

  const linkFor = (next: { sort?: UserSort; page?: number }) => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    p.set("sort", next.sort ?? sort);
    if (next.page) p.set("page", String(next.page));
    return `${ADMIN_PATH}/uzivatele?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="page-title">{t("title")}</h1>
        <p className="text-sm text-ink-soft">{t("description")}</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <form className="relative flex-1 min-w-48 max-w-xs" action={`${ADMIN_PATH}/uzivatele`}>
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
          />
          <input type="hidden" name="sort" value={sort} />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="h-11 w-full rounded-full border border-line bg-canvas pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:border-violet/60 focus-visible:ring-3 focus-visible:ring-violet/30 mouse:h-9"
          />
        </form>
        <div
          role="radiogroup"
          aria-label={t("sortBy")}
          className="flex rounded-full border border-line p-0.5"
        >
          {USER_SORTS.map((value) => (
            <Link
              key={value}
              href={linkFor({ sort: value })}
              role="radio"
              aria-checked={sort === value}
              prefetch={false}
              className={cn(
                "flex h-11 items-center rounded-full px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-violet/40 mouse:h-8",
                sort === value ? "bg-violet/20 text-ink" : "text-ink-soft hover:text-ink",
              )}
            >
              {t(`sort.${value}`)}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <GlowCard interactive={false} className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="text-xs text-ink-soft">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("columns.id")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("columns.plan")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("columns.status")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("columns.role")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("columns.signedUp")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("columns.lastActive")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t("columns.aiCost")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("columns.internal")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.userId} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">
                      <Link
                        href={`${ADMIN_PATH}/uzivatele/${row.userId}`}
                        prefetch={false}
                        className="text-violet underline-offset-2 hover:underline"
                      >
                        {row.userId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">{planLabel(row.plan)}</td>
                    <td className="px-4 py-2.5">{statusLabel(row.status)}</td>
                    <td className="px-4 py-2.5">{roleLabel(row.role)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                      {formatCalendarDate(row.signedUpAt.slice(0, 10), ADMIN_FORMAT_SETTINGS)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                      {row.lastActiveAt
                        ? formatDateTime(new Date(row.lastActiveAt), ADMIN_FORMAT_SETTINGS)
                        : "–"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatMetricValue(row.aiCostUsd, "usd", tUnits)}
                    </td>
                    <td className="px-4 py-2.5">
                      <InternalToggle userId={row.userId} value={row.isInternal} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlowCard>
      )}

      {(page > 0 || hasMore) && (
        <nav aria-label={t("pagination")} className="flex items-center justify-between gap-2">
          {page > 0 ? (
            <Link href={linkFor({ page: page - 1 })} prefetch={false} className="text-sm text-violet">
              {t("newer")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-ink-soft">{t("page", { page: page + 1 })}</span>
          {hasMore ? (
            <Link href={linkFor({ page: page + 1 })} prefetch={false} className="text-sm text-violet">
              {t("older")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
