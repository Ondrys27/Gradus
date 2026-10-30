import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { formatCalendarDate, formatDateTime, formatNumber } from "@/lib/format";
import { ADMIN_FORMAT_SETTINGS, formatMetricValue } from "@/features/admin/format-metric";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { adminCan } from "@/features/admin/roles";
import { loadUserDetail } from "@/features/admin/server/users-data";
import { loadUserAiCap } from "@/features/admin/server/ai-caps-data";
import { peopleNamer } from "@/features/admin/server/people";
import { CopyId } from "@/features/admin/ui/copy-id";
import { remainingUsd, userCapModeOf } from "@/features/jarvis/caps";
import { AdminCard, AdminEmpty, BlockGrid, PageSection } from "@/features/admin/ui/blocks";
import { AdminPageBar } from "@/features/admin/ui/page-bar";
import { InternalToggle } from "@/features/admin/ui/internal-toggle";
import { UserAiCapForm } from "@/features/admin/ui/user-ai-cap-form";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  // No name here: metadata is rendered apart from the page's admin guard.
  const t = await getTranslations("admin.users");
  return { title: t("detailMetaTitle") };
}

const SETTINGS = ADMIN_FORMAT_SETTINGS;
const count = (value: number) => formatNumber(value, {}, SETTINGS);

/**
 * One account. The facts first (as the key figures of a metrics page would
 * be), then AI use, then what happened; what changes the account (internal,
 * the AI cap) is at the end, with confirmation.
 */
export default async function AdminUserDetailPage({ params }: Props) {
  const context = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  await logAdminAction(context, "view", "users.detail");

  const [detail, nameOf, aiCap, t, tControls, tItems, tIndustry, tUnits] = await Promise.all([
    loadUserDetail(id),
    peopleNamer([id]),
    loadUserAiCap(id),
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
    <>
      <AdminPageBar title={nameOf(id)} description={t("detailDescription")} controls={<CopyId id={id} />} />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Fact label={t("columns.plan")} value={label(tControls, "plan", detail.plan)} />
            <Fact
              label={t("columns.status")}
              value={t.has(`status.${detail.status}`) ? t(`status.${detail.status}`) : detail.status}
            />
            <Fact label={t("columns.signedUp")} value={formatCalendarDate(detail.signedUpAt.slice(0, 10), SETTINGS)} />
            <Fact
              label={t("columns.lastActive")}
              value={detail.lastActiveAt ? formatDateTime(new Date(detail.lastActiveAt), SETTINGS) : "–"}
            />
            <Fact label={t("industry")} value={industryLabel(detail.industry)} />
            <Fact label={t("mode")} value={label(tControls, "mode", detail.mode)} />
            <Fact label={t("level")} value={detail.seenLevel ? count(detail.seenLevel) : "–"} />
            <Fact label={t("activeDays30")} value={count(detail.activeDays30)} />
            <Fact label={t("workers")} value={count(detail.workers)} />
            <Fact label={t("featureRequests")} value={count(detail.featureRequests)} />
            <Fact
              label={t("satisfaction")}
              value={
                detail.satisfaction === null
                  ? "–"
                  : t("satisfactionValue", { score: count(detail.satisfaction) })
              }
            />
            <Fact label={t("columns.internal")} value={detail.isInternal ? t("yes") : t("no")} />
          </dl>

          <BlockGrid>
            <AdminCard title={t("aiTitle")}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label={t("aiCalls")} value={count(detail.ai.calls)} />
                <Field label={tItems("ai_cost.name")} value={formatMetricValue(detail.ai.costUsd, "usd", tUnits)} />
                <Field label={t("inputTokens")} value={formatMetricValue(detail.ai.inputTokens, "tokens", tUnits)} />
                <Field label={t("outputTokens")} value={formatMetricValue(detail.ai.outputTokens, "tokens", tUnits)} />
              </dl>
            </AdminCard>

            <AdminCard title={t("sectionsTitle")} description={t("sectionsDescription")}>
              {detail.sections.length === 0 ? (
                <AdminEmpty hint={t("noActivity")} />
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {detail.sections
                    .sort((a, b) => b.actions - a.actions)
                    .map((row) => (
                      <li key={row.section} className="flex items-center justify-between text-sm">
                        <span className="text-ink-soft">
                          {t.has(`sections.${row.section}`) ? t(`sections.${row.section}`) : row.section}
                        </span>
                        <span className="font-semibold text-ink tabular-nums">{count(row.actions)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </AdminCard>

            <AdminCard title={t("timelineTitle")} description={t("timelineDescription")} wide>
              {detail.timeline.length === 0 ? (
                <AdminEmpty hint={t("noActivity")} />
              ) : (
                <ol className="flex max-h-96 flex-col overflow-y-auto text-sm">
                  {detail.timeline.map((row, index) => (
                    <li
                      key={index}
                      className="flex items-center justify-between gap-3 border-b border-line/60 py-1.5 last:border-0"
                    >
                      <span className="font-mono text-xs text-ink-soft">{row.event}</span>
                      <span className="shrink-0 text-xs text-ink-muted tabular-nums">
                        {formatDateTime(new Date(row.at), SETTINGS)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </AdminCard>
          </BlockGrid>
        </div>

        {/* What changes the account, at the end of the page. */}
        <PageSection title={t("changesTitle")} description={t("changesDescription")}>
          <BlockGrid>
            <AdminCard title={t("internalTitle")} description={t("internalDescription")}>
              <InternalToggle userId={id} value={detail.isInternal} />
            </AdminCard>

            <AdminCard title={t("aiCap.title")} description={t("aiCap.description")}>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={t("aiCap.spent")} value={formatMetricValue(aiCap.spentUsd, "usd", tUnits)} />
                <Field
                  label={t("aiCap.limit")}
                  value={
                    aiCap.limit.kind === "blocked"
                      ? t("aiCap.blocked")
                      : aiCap.limit.kind === "cap"
                        ? `${formatMetricValue(aiCap.limit.usd, "usd", tUnits)} · ${t(
                            aiCap.limit.source === "override" ? "aiCap.sourceOverride" : "aiCap.sourceGlobal",
                          )}`
                        : t("aiCap.noLimit")
                  }
                />
                <Field
                  label={t("aiCap.left")}
                  value={
                    aiCap.limit.kind === "cap"
                      ? formatMetricValue(remainingUsd(aiCap.limit.usd, aiCap.spentUsd), "usd", tUnits)
                      : aiCap.limit.kind === "blocked"
                        ? formatMetricValue(0, "usd", tUnits)
                        : t("aiCap.noLimit")
                  }
                />
              </dl>
              {/* An admin reads the exception above; changing it is the owner's. */}
              {adminCan(context.role, "editAiCaps") && (
                <UserAiCapForm
                  userId={id}
                  mode={userCapModeOf(aiCap.override)}
                  capUsd={aiCap.override?.capUsd ?? null}
                />
              )}
            </AdminCard>
          </BlockGrid>
        </PageSection>
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-line bg-surface px-4 py-3">
      <dt className="truncate text-xs text-ink-muted">{label}</dt>
      <dd className="truncate text-base font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="truncate text-xs text-ink-muted">{label}</dt>
      <dd className="text-lg font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}
