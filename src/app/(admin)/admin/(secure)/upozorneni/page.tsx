import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { logAdminAction } from "@/features/admin/server/audit";
import { loadErrorAlerts } from "@/features/admin/server/error-alerts-data";
import { requireAdmin } from "@/features/admin/server/guard";
import { peopleNamer } from "@/features/admin/server/people";
import { adminCan } from "@/features/admin/roles";
import { ADMIN_FORMAT_SETTINGS } from "@/features/admin/format-metric";
import { AdminCard } from "@/features/admin/ui/blocks";
import { ErrorAlertsForm } from "@/features/admin/ui/error-alerts-form";
import { AdminPageBar } from "@/features/admin/ui/page-bar";
import {
  DIGEST_HOUR_UTC,
  ERROR_ALERT_LIMITS,
  MAX_ALERT_EMAILS,
} from "@/features/errors/alerts/settings";
import { formatDateTime } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.errorAlerts");
  return { title: t("title") };
}

/**
 * Settings → Error alerts: the addresses the e-mail about every error goes
 * to, every error on its own or a summary, and a test e-mail. The owner
 * edits; an admin reads.
 */
export default async function AdminErrorAlertsPage() {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "error_alerts");
  const canEdit = adminCan(context.role, "editErrorAlerts");
  const [data, t] = await Promise.all([loadErrorAlerts(), getTranslations("admin.errorAlerts")]);
  const nameOf = await peopleNamer([data.updatedBy]);
  const updated =
    data.updatedAt && data.stored
      ? t("updated", {
          date: formatDateTime(new Date(data.updatedAt), ADMIN_FORMAT_SETTINGS),
          name: data.updatedBy ? nameOf(data.updatedBy) : t("unknownPerson"),
        })
      : null;

  return (
    <>
      <AdminPageBar title={t("title")} description={t("description")} />
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
      </div>
    </>
  );
}
