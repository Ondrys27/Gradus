import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { peopleNamer } from "@/features/admin/server/people";
import { loadCatalogVersions, type CatalogVersion } from "@/features/admin/server/plans-data";
import { loadPlanUserCounts, type PlanUserCount } from "@/features/admin/server/subscription-data";
import { ADMIN_FORMAT_SETTINGS } from "@/features/admin/format-metric";
import { getExchangeRates } from "@/features/currency/server/rates";
import { formatNumber } from "@/lib/format";
import { adminCan } from "@/features/admin/roles";
import { AdminCard } from "@/features/admin/ui/blocks";
import { AdminPageBar } from "@/features/admin/ui/page-bar";
import { PlansEditor } from "@/features/admin/ui/plans-editor";
import { PlansHistory, type HistoryVersion } from "@/features/admin/ui/plans-history";
import { PlansPreview, type PreviewMessages } from "@/features/admin/ui/plans-preview";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.plans");
  return { title: t("title") };
}

/** The cards in each language need the plan texts and the website's button, nothing more. */
const PREVIEW_MESSAGES: PreviewMessages = {
  cs: { plans: cs.plans, marketing: { cta: cs.marketing.cta } },
  en: { plans: en.plans, marketing: { cta: en.marketing.cta } },
};

/**
 * Settings → Plans: the owner edits a draft of the plan catalog and publishes
 * it; until then the website and the app show the published version. An
 * admin sees the published plans and the history, without editing.
 */
export default async function AdminPlansPage() {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "plans");
  const canEdit = adminCan(context.role, "editPlans");

  const [versions, counts, rates, t, tControls] = await Promise.all([
    loadCatalogVersions(),
    loadPlanUserCounts(),
    getExchangeRates(),
    getTranslations("admin.plans"),
    getTranslations("admin.controls"),
  ]);
  const nameOf = await peopleNamer(
    [versions.published, ...versions.history].map((version) => version.publishedBy),
  );
  const toHistory = (version: CatalogVersion): HistoryVersion => ({
    id: version.id,
    publishedAt: version.publishedAt,
    publishedBy: version.publishedBy ? nameOf(version.publishedBy) : null,
    catalog: version.catalog,
    addOns: version.addOns,
  });

  return (
    <>
      <AdminPageBar title={t("title")} description={t("description")} />
      <div className="flex flex-col gap-4">
        {canEdit ? (
          <PlansEditor
            published={{
              id: versions.published.id,
              catalog: versions.published.catalog,
              addOns: versions.published.addOns,
            }}
            draft={
              versions.draft
                ? {
                    catalog: versions.draft.catalog,
                    addOns: versions.draft.addOnsStored ? versions.draft.addOns : null,
                    createdAt: versions.draft.createdAt,
                  }
                : null
            }
            rates={rates}
            previewMessages={PREVIEW_MESSAGES}
          />
        ) : (
          <AdminCard title={t("preview.publishedTitle")} description={t("readOnly")}>
            <PlansPreview
              catalog={versions.published.catalog}
              addOns={versions.published.addOns}
              rates={rates}
              messages={PREVIEW_MESSAGES}
            />
          </AdminCard>
        )}
        <AdminCard title={t("counts.title")} description={t("counts.description")}>
          <PlanCounts
            counts={counts}
            t={t}
            planLabel={(key) =>
              tControls.has(`segmentValues.plan.${key}`) ? tControls(`segmentValues.plan.${key}`) : key
            }
          />
        </AdminCard>
        <AdminCard title={t("history.title")} description={t("history.description")}>
          <PlansHistory
            current={toHistory(versions.published)}
            history={versions.history.map(toHistory)}
            readOnly={!canEdit}
          />
        </AdminCard>
      </div>
    </>
  );
}

/** Beta first, then the catalog's plans, then anything else. */
const PLAN_ORDER = ["beta", "solo", "pro", "team"];

function PlanCounts({
  counts,
  t,
  planLabel,
}: {
  counts: PlanUserCount[];
  t: Awaited<ReturnType<typeof getTranslations<"admin.plans">>>;
  planLabel: (key: string) => string;
}) {
  if (counts.length === 0) return <p className="text-sm text-ink-muted">{t("counts.empty")}</p>;
  const n = (value: number) => formatNumber(value, {}, ADMIN_FORMAT_SETTINGS);
  const rank = (key: string) => (PLAN_ORDER.includes(key) ? PLAN_ORDER.indexOf(key) : PLAN_ORDER.length);
  const rows = [...counts].sort((a, b) => rank(a.planKey) - rank(b.planKey));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="admin-plan-counts">
        <thead>
          <tr className="text-left text-xs text-ink-muted">
            <th className="py-2 pr-4 font-medium">{t("counts.plan")}</th>
            <th className="py-2 pr-4 text-right font-medium">{t("counts.accounts")}</th>
            <th className="py-2 pr-4 text-right font-medium">{t("counts.trialing")}</th>
            <th className="py-2 pr-4 text-right font-medium">{t("counts.cancelling")}</th>
            <th className="py-2 text-right font-medium">{t("counts.expired")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.planKey} className="border-t border-line/60">
              <td className="py-2 pr-4 text-ink">{planLabel(row.planKey)}</td>
              <td className="py-2 pr-4 text-right font-semibold text-ink tabular-nums">{n(row.accounts)}</td>
              <td className="py-2 pr-4 text-right text-ink-soft tabular-nums">{n(row.trialing)}</td>
              <td className="py-2 pr-4 text-right text-ink-soft tabular-nums">{n(row.cancelling)}</td>
              <td className="py-2 text-right text-ink-soft tabular-nums">{n(row.expired)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
