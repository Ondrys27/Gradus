import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ADMIN_FORMAT_SETTINGS } from "@/features/admin/format-metric";
import { adminCan } from "@/features/admin/roles";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { loadPeople } from "@/features/admin/server/people";
import { AdminCard } from "@/features/admin/ui/blocks";
import { CalendarSyncControls } from "@/features/admin/ui/calendar-sync-controls";
import { AdminPageBar } from "@/features/admin/ui/page-bar";
import { displayName } from "@/features/admin/display-name";
import { loadCalendarSyncSetting } from "@/features/calendar/sync/server/settings";
import { dayIn } from "@/features/scheduler/zoned";
import { METRICS_TIMEZONE } from "@/lib/analytics/metrics";
import { APP_NAME } from "@/lib/constants";
import { formatDate } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.integrations");
  return { title: t("title") };
}

/**
 * Administration → Settings → Integrations (step 28.10): who may connect a
 * Google or Apple calendar until Google verifies the app.
 */
export default async function AdminIntegrationsPage() {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "integrations");
  const [t, setting] = await Promise.all([
    getTranslations("admin.integrations"),
    loadCalendarSyncSetting(),
  ]);
  const people = await loadPeople(setting.allow_users).catch((error: unknown) => {
    console.error("[admin] people names unavailable", error);
    return new Map<string, { name: string | null; email: string | null }>();
  });
  const accounts = setting.allow_users.map((id) => ({
    id,
    label: displayName(id, people.get(id), (suffix) => t("unnamed", { suffix })),
    email: people.get(id)?.name ? (people.get(id)?.email ?? null) : null,
  }));
  const before = setting.allow_created_before ? Date.parse(setting.allow_created_before) : null;

  return (
    <>
      <AdminPageBar title={t("title")} description={t("description", { appName: APP_NAME })} />
      <div className="flex flex-col gap-4">
        <AdminCard title={t("sync.title")} description={t("sync.description")}>
          <CalendarSyncControls
            everyone={setting.mode === "everyone"}
            dateValue={before === null ? "" : dayIn(before, METRICS_TIMEZONE)}
            dateText={before === null ? null : formatDate(new Date(before), ADMIN_FORMAT_SETTINGS)}
            accounts={accounts}
            readOnly={!adminCan(context, "editCalendarSync")}
          />
        </AdminCard>
      </div>
    </>
  );
}
