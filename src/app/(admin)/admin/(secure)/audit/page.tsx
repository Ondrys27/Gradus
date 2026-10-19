import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ADMIN_PATH } from "@/features/admin/access";
import { logAdminAction } from "@/features/admin/server/audit";
import { loadAuditPage } from "@/features/admin/server/audit-data";
import { requireAdmin } from "@/features/admin/server/guard";
import { mayExport } from "@/features/admin/roles";
import { parseAdminView, serializeAdminView } from "@/features/admin/view-state";
import { AuditExportButton } from "@/features/admin/ui/audit-export-button";
import { AdminEmpty } from "@/features/admin/ui/blocks";
import { AdminPageBar } from "@/features/admin/ui/page-bar";
import { ServerPager, ServerTable } from "@/features/admin/ui/server-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.audit");
  return { title: t("title") };
}

/**
 * The audit is a list, newest first: no numbers, no filters. The export of
 * the whole audit names people, so it is the owner's, and it sits at the
 * end of the page.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "audit");
  const [params, t] = await Promise.all([searchParams, getTranslations("admin.audit")]);
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const page = Math.min(10_000, Math.max(0, Number.parseInt(rawPage ?? "0", 10) || 0));
  const { rows, hasMore } = await loadAuditPage(context, page, t("emptyValue"));
  // The audit has no filters, but the view of the other pages stays in the address.
  const kept = serializeAdminView(parseAdminView(params));
  const pageHref = (n: number) => {
    const query = new URLSearchParams(kept);
    if (n > 0) query.set("page", String(n));
    return query.size ? `${ADMIN_PATH}/audit?${query}` : `${ADMIN_PATH}/audit`;
  };
  const mono = "font-mono text-xs";

  return (
    <>
      <AdminPageBar title={t("title")} description={t("description")} />
      <div className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <AdminEmpty title={t("emptyTitle")} hint={t("emptyDescription")} />
        ) : (
          <ServerTable
            columns={[
              { key: "time", label: t("columns.time") },
              { key: "who", label: t("columns.who") },
              { key: "kind", label: t("columns.kind") },
              { key: "target", label: t("columns.target") },
              { key: "detail", label: t("columns.detail") },
              { key: "ip", label: t("columns.ip") },
            ]}
            minWidth="44rem"
            caption={t("title")}
            rows={rows.map((row) => ({
              key: String(row.id),
              cells: [
                <span key="time" className="text-ink tabular-nums">
                  {row.time}
                </span>,
                <span key="who" className="text-ink">
                  {row.who}
                </span>,
                t(`kinds.${row.kind}`),
                <span key="target" className={mono}>
                  {row.target}
                </span>,
                <span key="detail" className={mono}>
                  {row.detail}
                </span>,
                <span key="ip" className={mono}>
                  {row.ip}
                </span>,
              ],
            }))}
          />
        )}
        <ServerPager
          page={page}
          hasMore={hasMore}
          hrefFor={pageHref}
          labels={{
            pagination: t("pagination"),
            newer: t("newer"),
            older: t("older"),
            page: t("page", { page: page + 1 }),
          }}
        />
        {/* Asks first; the file download is written to the audit on the server. */}
        {mayExport(context.role, "audit") && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm">
            <span className="text-ink-muted">{t("exportHint")}</span>
            <AuditExportButton href={`${ADMIN_PATH}/audit/export`} label={t("export")} />
          </div>
        )}
      </div>
    </>
  );
}
