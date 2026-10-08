import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/ui/page-header";
import { formatCalendarDate, formatDateTime } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "@/features/admin/format-metric";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { loadUserDetail } from "@/features/admin/server/users-data";
import { AdminCard } from "@/features/admin/ui/blocks";
import { InternalToggle } from "@/features/admin/ui/internal-toggle";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("admin.users");
  return { title: t("detailTitle", { id: id.slice(0, 8) }) };
}

export default async function AdminUserDetailPage({ params }: Props) {
  const context = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  await logAdminAction(context, "view", "users.detail");

  const [detail, t, tControls, tItems, tIndustry, tUnits] = await Promise.all([
    loadUserDetail(id),
    getTranslations("admin.users"),
    getTranslations("admin.controls"),
    getTranslations("metrics.items"),
    getTranslations("onboarding.industry.industries"),
    getTranslations("admin.units"),
  ]);
  if (!detail) notFound();

  const label = (namespace: typeof tControls, key: string, value: string | null) =>
    value && namespace.has(`segmentValues.${key}.${value}`)
      ? namespace(`segmentValues.${key}.${value}`)
      : (value ?? "–");
  const industryLabel = (value: string | null) =>
    value && tIndustry.has(`${value}.label`) ? tIndustry(`${value}.label`) : (value ?? "–");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("detailTitle", { id: id.slice(0, 8) })}
        description={t("detailDescription")}
        actions={<InternalToggle userId={id} value={detail.isInternal} />}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Fact label={t("columns.plan")} value={label(tControls, "plan", detail.plan)} />
        <Fact
          label={t("columns.status")}
          value={t.has(`status.${detail.status}`) ? t(`status.${detail.status}`) : detail.status}
        />
        <Fact label={t("columns.signedUp")} value={formatCalendarDate(detail.signedUpAt.slice(0, 10), ADMIN_FORMAT_SETTINGS)} />
        <Fact
          label={t("columns.lastActive")}
          value={detail.lastActiveAt ? formatDateTime(new Date(detail.lastActiveAt), ADMIN_FORMAT_SETTINGS) : "–"}
        />
        <Fact label={t("industry")} value={industryLabel(detail.industry)} />
        <Fact label={t("mode")} value={label(tControls, "mode", detail.mode)} />
        <Fact label={t("level")} value={detail.seenLevel ? String(detail.seenLevel) : "–"} />
        <Fact label={t("activeDays30")} value={String(detail.activeDays30)} />
        <Fact label={t("workers")} value={String(detail.workers)} />
        <Fact label={t("featureRequests")} value={String(detail.featureRequests)} />
        <Fact label={t("npsScore")} value={detail.npsScore === null ? "–" : String(detail.npsScore)} />
      </div>

      <AdminCard title={t("aiTitle")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label={t("aiCalls")} value={String(detail.ai.calls)} />
          <Fact label={tItems("ai_cost.name")} value={formatMetricValue(detail.ai.costUsd, "usd", tUnits)} />
          <Fact label={t("inputTokens")} value={formatMetricValue(detail.ai.inputTokens, "tokens", tUnits)} />
          <Fact label={t("outputTokens")} value={formatMetricValue(detail.ai.outputTokens, "tokens", tUnits)} />
        </div>
      </AdminCard>

      <AdminCard title={t("sectionsTitle")} description={t("sectionsDescription")}>
        {detail.sections.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">{t("noActivity")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {detail.sections
              .sort((a, b) => b.actions - a.actions)
              .map((row) => (
                <li key={row.section} className="flex items-center justify-between text-sm">
                  <span className="text-ink-soft">
                    {t.has(`sections.${row.section}`) ? t(`sections.${row.section}`) : row.section}
                  </span>
                  <span className="font-semibold text-ink tabular-nums">{row.actions}</span>
                </li>
              ))}
          </ul>
        )}
      </AdminCard>

      <AdminCard title={t("timelineTitle")} description={t("timelineDescription")}>
        {detail.timeline.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">{t("noActivity")}</p>
        ) : (
          <ol className="flex max-h-96 flex-col gap-1 overflow-y-auto text-sm">
            {detail.timeline.map((row, index) => (
              <li key={index} className="flex items-center justify-between gap-3 border-b border-line py-1.5 last:border-0">
                <span className="font-mono text-xs text-ink-soft">{row.event}</span>
                <span className="shrink-0 text-xs text-ink-muted tabular-nums">
                  {formatDateTime(new Date(row.at), ADMIN_FORMAT_SETTINGS)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </AdminCard>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-surface p-3">
      <span className="micro-label truncate">{label}</span>
      <span className="stat-number text-lg text-ink">{value}</span>
    </div>
  );
}
