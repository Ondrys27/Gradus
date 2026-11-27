import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ADMIN_PATH } from "@/features/admin/access";
import { digestPrefsOf, digestZone } from "@/features/admin/digest/schedule";
import { displayName } from "@/features/admin/display-name";
import { ADMIN_FORMAT_SETTINGS } from "@/features/admin/format-metric";
import { adminCan, adminStanding, parseAdminLevel, parseAdminRole } from "@/features/admin/roles";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireAdmin } from "@/features/admin/server/guard";
import { AdminCard } from "@/features/admin/ui/blocks";
import { DigestPrefsForm } from "@/features/admin/ui/digest-prefs-form";
import { AdminPageBar } from "@/features/admin/ui/page-bar";
import { APP_NAME } from "@/lib/constants";
import { formatTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.digest");
  return { title: t("title") };
}

/**
 * Administration → Settings → Notifications (30.1): the daily summary
 * "Gradus včera" of every administrator, each with their hour, zone and
 * "only when there is news". Everyone sets their own; the owner and the full
 * administrators everyone's. The instant e-mails about errors stay where they
 * were (Operations → Errors → E-mail alerts), off by default.
 */
export default async function AdminNotificationsPage() {
  const context = await requireAdmin();
  await logAdminAction(context, "view", "settings.admin_digest");
  const t = await getTranslations("admin.digest");
  const tPeople = await getTranslations("admin.people");
  const admin = createAdminClient();

  const { data: roles } = await admin
    .from("user_roles")
    .select("user_id, role, level")
    .in("role", ["owner", "admin"]);
  const ids = [...new Set((roles ?? []).map((row) => row.user_id))];
  const [people, prefs, settings] = await Promise.all([
    admin.rpc("admin_people", { _ids: ids }),
    admin
      .from("admin_notify_prefs")
      .select("user_id, digest_enabled, digest_hour, digest_only_news, digest_time_zone")
      .in("user_id", ids),
    admin.from("user_settings").select("user_id, timezone").in("user_id", ids),
  ]);
  const person = new Map((people.data ?? []).map((row) => [row.user_id, row]));
  const pref = new Map((prefs.data ?? []).map((row) => [row.user_id, row]));
  const zone = new Map((settings.data ?? []).map((row) => [row.user_id, row.timezone]));
  const hourLabels = Array.from({ length: 24 }, (_, hour) =>
    formatTime(new Date(Date.UTC(2026, 0, 1, hour)), { ...ADMIN_FORMAT_SETTINGS, timeZone: "UTC" }),
  );
  const editOthers = adminCan(context, "editDigests");

  // Who may not change the others' summaries sees only their own.
  const rows = (roles ?? [])
    .flatMap((row) => {
      const role = parseAdminRole(row.role);
      const own = row.user_id === context.userId;
      if (!role || (!own && !editOthers)) return [];
      return [{ row, role, level: parseAdminLevel(role, row.level), own }];
    })
    .sort((a, b) => Number(b.own) - Number(a.own));

  return (
    <>
      <AdminPageBar title={t("title")} description={t("description", { appName: APP_NAME })} />
      <div className="flex flex-col gap-4">
        {rows.map(({ row, role, level, own }) => {
          const stored = digestPrefsOf(pref.get(row.user_id));
          const who = person.get(row.user_id);
          const name = displayName(
            row.user_id,
            who ? { name: who.display_name, email: who.email } : undefined,
            (suffix) => tPeople("unnamed", { suffix }),
          );
          const accountZone = digestZone({ ...stored, timeZone: null }, zone.get(row.user_id));
          return (
            <AdminCard
              key={row.user_id}
              id={own ? "denni-souhrn" : undefined}
              title={own ? t("ownTitle") : name}
              description={t(`standing.${adminStanding({ role, level })}`)}
            >
              <div data-tutorial={own ? "admin-digest-prefs" : undefined}>
                <DigestPrefsForm
                  userId={row.user_id}
                  initial={stored}
                  accountZone={accountZone}
                  hourLabels={hourLabels}
                  readOnly={false}
                  own={own}
                />
              </div>
            </AdminCard>
          );
        })}
        <p className="text-sm text-ink-soft">
          {t("instantHint")}{" "}
          <Link
            href={`${ADMIN_PATH}/chyby?tab=alerts`}
            className="text-violet underline-offset-4 hover:underline"
          >
            {t("instantLink")}
          </Link>
        </p>
      </div>
    </>
  );
}
