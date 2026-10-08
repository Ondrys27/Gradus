import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DownloadIcon } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowCard } from "@/components/ui/glow-card";
import { PageHeader } from "@/components/ui/page-header";
import { ADMIN_PATH } from "@/features/admin/access";
import { logAdminAction } from "@/features/admin/server/audit";
import { loadAuditPage } from "@/features/admin/server/audit-data";
import { requireAdmin } from "@/features/admin/server/guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.audit");
  return { title: t("title") };
}

const linkClass =
  "flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-violet outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50";

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "audit");
  const [{ page: rawPage }, t] = await Promise.all([searchParams, getTranslations("admin.audit")]);
  const page = Math.min(10_000, Math.max(0, Number.parseInt(rawPage ?? "0", 10) || 0));
  const { rows, hasMore } = await loadAuditPage(context, page);
  const pageHref = (n: number) => (n > 0 ? `${ADMIN_PATH}/audit?page=${n}` : `${ADMIN_PATH}/audit`);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          // A plain link: the export is a file download, written to the audit on the server.
          <a href={`${ADMIN_PATH}/audit/export`} className={linkClass} download>
            <DownloadIcon aria-hidden className="size-4" />
            {t("export")}
          </a>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <GlowCard interactive={false} className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs text-ink-soft">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("columns.time")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("columns.who")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("columns.kind")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("columns.target")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("columns.ip")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{row.time}</td>
                    <td className="px-4 py-2.5">{row.who}</td>
                    <td className="px-4 py-2.5">{t(`kinds.${row.kind}`)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{row.target}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-soft">{row.ip}</td>
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
            <Link href={pageHref(page - 1)} prefetch={false} className={linkClass}>
              {t("newer")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-ink-soft">{t("page", { page: page + 1 })}</span>
          {hasMore ? (
            <Link href={pageHref(page + 1)} prefetch={false} className={linkClass}>
              {t("older")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
