import "server-only";
import { runInBackground } from "@/features/errors/alerts/server/background";
import { serverTranslator } from "@/i18n/server-translator";
import { APP_NAME } from "@/lib/constants";
import { deliverEmail } from "@/lib/email/e2e-outbox";
import { escapeHtml } from "@/lib/email/resend";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayName } from "../display-name";
import { peerChangePath, peerRecipients, type PeerCandidate, type PeerChange } from "../peer-notices";
import { parseAdminLevel, parseAdminRole } from "../roles";
import type { AdminContext } from "./guard";

/**
 * The e-mail "Váša changed the plans" to the other people who may change
 * them (the owner and the full administrators), after the change is saved.
 * It runs after the response and never throws: a failed e-mail is only
 * logged, the change stays.
 */
export async function notifyPeers(context: Pick<AdminContext, "userId">, change: PeerChange): Promise<void> {
  // The request's headers are read now; the rest runs after the response.
  const origin = await siteOrigin().catch(() => null);
  if (!origin) return;
  runInBackground("admin peer notice", () => sendPeerNotices(context.userId, change, origin));
}

async function sendPeerNotices(actorId: string, change: PeerChange, origin: string): Promise<void> {
  const admin = createAdminClient();
  const { data: roles, error } = await admin
    .from("user_roles")
    .select("user_id, role, level")
    .in("role", ["owner", "admin"]);
  if (error) throw new Error(`user_roles: ${error.message}`);
  const ids = [...new Set([actorId, ...(roles ?? []).map((row) => row.user_id)])];
  const [people, prefs, settings] = await Promise.all([
    admin.rpc("admin_people", { _ids: ids }),
    admin.from("admin_notify_prefs").select("user_id, peer_changes").in("user_id", ids),
    admin.from("user_settings").select("user_id, locale").in("user_id", ids),
  ]);
  if (people.error) throw new Error(`admin_people: ${people.error.message}`);
  const person = new Map((people.data ?? []).map((row) => [row.user_id, row]));
  const off = new Set((prefs.data ?? []).filter((row) => !row.peer_changes).map((row) => row.user_id));
  const locale = new Map((settings.data ?? []).map((row) => [row.user_id, row.locale]));

  const candidates: PeerCandidate[] = (roles ?? []).flatMap((row) => {
    const role = parseAdminRole(row.role);
    if (!role) return [];
    return [
      {
        userId: row.user_id,
        role,
        level: parseAdminLevel(role, row.level),
        email: person.get(row.user_id)?.email ?? null,
        wantsMail: !off.has(row.user_id),
      },
    ];
  });
  const actorPerson = person.get(actorId);
  const recipients = peerRecipients({ userId: actorId, email: actorPerson?.email ?? null }, candidates);
  if (!recipients.length) return;

  const url = `${origin}${peerChangePath(change)}`;
  const auditUrl = `${origin}/admin/audit`;
  for (const recipient of recipients) {
    const t = serverTranslator(locale.get(recipient.userId));
    const name = displayName(
      actorId,
      actorPerson ? { name: actorPerson.display_name, email: actorPerson.email } : undefined,
      (suffix) => t("admin.people.unnamed", { suffix }),
    );
    const values = { name, appName: APP_NAME };
    const subject = t(`admin.peerNotice.subject.${change}`, values);
    const lines = [
      t(`admin.peerNotice.body.${change}`, values),
      t("admin.peerNotice.audit"),
      t("admin.peerNotice.off"),
    ];
    const sent = await deliverEmail({
      to: recipient.email!,
      subject,
      text: [lines[0], "", url, "", lines[1], auditUrl, "", lines[2]].join("\n"),
      html: `<p>${escapeHtml(lines[0])}</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(t("admin.peerNotice.open"))}</a></p>
<p>${escapeHtml(lines[1])} <a href="${escapeHtml(auditUrl)}">${escapeHtml(t("admin.peerNotice.auditLink"))}</a></p>
<p>${escapeHtml(lines[2])}</p>`,
    });
    if (!sent.ok) console.error("[admin] peer notice failed", sent.error);
  }
}
