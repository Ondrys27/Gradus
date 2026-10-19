import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { splitBrowserLabel } from "@/features/admin/client-info";
import { ADMIN_FORMAT_SETTINGS } from "@/features/admin/format-metric";
import { loadAdminMembers, loadOpenInvites } from "@/features/admin/server/admins-data";
import { logAdminAction } from "@/features/admin/server/audit";
import { requireOwnerFor } from "@/features/admin/server/guard";
import { loadPeople } from "@/features/admin/server/people";
import { displayName } from "@/features/admin/display-name";
import {
  InviteAdminButton,
  RemoveAdminButton,
  RevokeInviteButton,
} from "@/features/admin/ui/admins-controls";
import { AdminCard } from "@/features/admin/ui/blocks";
import { formatDateTime } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.admins");
  return { title: t("title") };
}

const when = (iso: string | null, empty: string) =>
  iso ? formatDateTime(new Date(iso), ADMIN_FORMAT_SETTINGS) : empty;

/**
 * Who can enter the administration: the owner and the administrators, with
 * sign-ins and sessions, and the invitations still open. The owner's page
 * only; an admin gets the 404 and never sees it in the menu.
 */
export default async function AdminAdminsPage() {
  const context = await requireOwnerFor("manageAdmins");
  await logAdminAction(context, "view", "admins");

  const [members, invites, t, tBrowser, tDevice, tPeople] = await Promise.all([
    loadAdminMembers(),
    loadOpenInvites(),
    getTranslations("admin.admins"),
    getTranslations("admin.browser"),
    getTranslations("admin.device"),
    getTranslations("admin.people"),
  ]);
  const people = await loadPeople(members.map((member) => member.userId)).catch((error: unknown) => {
    console.error("[admin] people names unavailable", error);
    return new Map();
  });
  const empty = "–";
  const browser = (label: string | null) => {
    const parts = splitBrowserLabel(label);
    if (!parts) return empty;
    const b = tBrowser.has(parts.browser) ? tBrowser(parts.browser) : parts.browser;
    const d = tDevice.has(parts.device) ? tDevice(parts.device) : parts.device;
    return `${b} · ${d}`;
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<InviteAdminButton />}
      />

      <AdminCard title={t("membersTitle")}>
        <ul className="flex flex-col divide-y divide-line" data-testid="admin-members">
          {members.map((member) => {
            const person = people.get(member.userId);
            const name = displayName(member.userId, person, (suffix) =>
              tPeople("unnamed", { suffix }),
            );
            const removable = member.role === "admin" && member.active && member.userId !== context.userId;
            return (
              <li key={member.userId} className="flex flex-col gap-3 py-3" data-testid="admin-member">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-semibold text-ink">{name}</span>
                    <span className="truncate text-sm text-ink-soft">{person?.email ?? empty}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={member.role === "owner" ? "gold" : "violet"}>
                      {t(`role.${member.role}`)}
                    </StatusPill>
                    <StatusPill tone={member.active ? "green" : "neutral"}>
                      {t(member.active ? "status.active" : "status.removed")}
                    </StatusPill>
                    {removable && <RemoveAdminButton userId={member.userId} name={name} />}
                  </div>
                </div>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  <Fact label={t("lastLogin")} value={when(member.lastLoginAt, empty)} />
                  <Fact label={t("logins30d")} value={String(member.logins30d)} />
                  <Fact label={t("lastSeen")} value={when(member.lastSeenAt, empty)} />
                  {member.removedAt && <Fact label={t("removedAt")} value={when(member.removedAt, empty)} />}
                </dl>
                <details className="group rounded-xl border border-line">
                  <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-violet/40">
                    {t("history")}
                  </summary>
                  <div className="grid grid-cols-1 gap-4 px-3 pb-3 lg:grid-cols-2">
                    <section className="flex min-w-0 flex-col gap-2">
                      <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                        {t("loginsTitle")}
                      </h3>
                      {member.logins.length === 0 ? (
                        <p className="text-sm text-ink-muted">{t("none")}</p>
                      ) : (
                        <ul className="flex flex-col gap-1 text-sm">
                          {member.logins.map((login) => (
                            <li key={login.at} className="flex flex-wrap justify-between gap-x-3">
                              <span className="text-ink tabular-nums">{when(login.at, empty)}</span>
                              <span className="text-ink-soft">
                                <span className="font-mono text-xs">{login.ipPrefix ?? empty}</span>
                                {" · "}
                                {browser(login.browser)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    <section className="flex min-w-0 flex-col gap-2">
                      <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                        {t("sessionsTitle")}
                      </h3>
                      {member.sessions.length === 0 ? (
                        <p className="text-sm text-ink-muted">{t("none")}</p>
                      ) : (
                        <ul className="flex flex-col gap-1 text-sm">
                          {member.sessions.map((session) => (
                            <li key={session.startedAt} className="flex flex-wrap justify-between gap-x-3">
                              <span className="text-ink tabular-nums">{when(session.startedAt, empty)}</span>
                              <span className="text-ink-soft tabular-nums">
                                {session.endedAt
                                  ? t("sessionEnded", { at: when(session.endedAt, empty) })
                                  : t("sessionLastSeen", { at: when(session.lastSeenAt, empty) })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </AdminCard>

      <AdminCard title={t("invitesTitle")} description={t("invitesDescription")}>
        {invites.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">{t("noInvites")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="admin-invites">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                  <span className="truncate font-medium text-ink">{invite.email ?? t("noEmail")}</span>
                  {invite.note && <span className="truncate text-ink-soft">{invite.note}</span>}
                  <span className="text-xs text-ink-muted">
                    {t("inviteDates", {
                      created: when(invite.createdAt, empty),
                      expires: when(invite.expiresAt, empty),
                    })}
                  </span>
                </div>
                <RevokeInviteButton id={invite.id} />
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="truncate text-ink tabular-nums">{value}</dd>
    </div>
  );
}
