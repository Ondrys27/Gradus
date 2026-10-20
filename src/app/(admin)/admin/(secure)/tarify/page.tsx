import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { peopleNamer } from "@/features/admin/server/people";
import { loadCatalogVersions, type CatalogVersion } from "@/features/admin/server/plans-data";
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

  const [versions, t] = await Promise.all([loadCatalogVersions(), getTranslations("admin.plans")]);
  const nameOf = await peopleNamer(
    [versions.published, ...versions.history].map((version) => version.publishedBy),
  );
  const toHistory = (version: CatalogVersion): HistoryVersion => ({
    id: version.id,
    publishedAt: version.publishedAt,
    publishedBy: version.publishedBy ? nameOf(version.publishedBy) : null,
    catalog: version.catalog,
  });

  return (
    <>
      <AdminPageBar title={t("title")} description={t("description")} />
      <div className="flex flex-col gap-4">
        {canEdit ? (
          <PlansEditor
            published={{ id: versions.published.id, catalog: versions.published.catalog }}
            draft={
              versions.draft
                ? { catalog: versions.draft.catalog, createdAt: versions.draft.createdAt }
                : null
            }
            previewMessages={PREVIEW_MESSAGES}
          />
        ) : (
          <AdminCard title={t("preview.publishedTitle")} description={t("readOnly")}>
            <PlansPreview catalog={versions.published.catalog} messages={PREVIEW_MESSAGES} />
          </AdminCard>
        )}
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
