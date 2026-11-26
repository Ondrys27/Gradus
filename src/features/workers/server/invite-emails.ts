import "server-only";
import { serverTranslator } from "@/i18n/server-translator";
import { APP_NAME } from "@/lib/constants";
import { escapeHtml } from "@/lib/email/resend";
import { accessSentences, sectionNavKey } from "../access-summary";
import type { PermissionGrants } from "../permissions-catalog";

/**
 * The e-mails around joining a company (step 22.5): the invite itself (to an
 * account, pointing at the invites in the app; to a new person, with the
 * registration link) and the owner's note that somebody left. Plain text and
 * a simple HTML twin, texts from `email.workerInvite.*` and `email.workerLeft.*`.
 */

export type InviteEmail = { subject: string; text: string; html: string };

const BUTTON =
  "background:#7C5CFF;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600";

function render(
  paragraphs: readonly string[],
  button: { label: string; url: string } | null,
  list: { title: string; items: readonly string[]; after: readonly string[] } | null = null,
): string {
  const body = paragraphs
    .map((line) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapeHtml(line)}</p>`)
    .join("\n");
  const access = list
    ? `<p style="margin:16px 0 6px;font-size:15px;font-weight:600">${escapeHtml(list.title)}</p>
<ul style="margin:0 0 12px;padding-left:20px;font-size:15px;line-height:1.5">${list.items
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ul>${list.after
        .map((line) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#55556a">${escapeHtml(line)}</p>`)
        .join("")}`
    : "";
  const action = button
    ? `<p style="margin:20px 0"><a href="${escapeHtml(button.url)}" style="${BUTTON}">${escapeHtml(button.label)}</a></p>`
    : "";
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a2e;max-width:560px">
${body}
${access}
${action}
</div>`;
}

/** Who invites: "Novák s.r.o. · Václav Novák", or whichever of the two is known. */
export function inviterLabel(company: string | null, owner: string | null, fallback: string): string {
  const parts = [company?.trim(), owner?.trim()].filter((part): part is string => Boolean(part));
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return unique.length ? unique.join(" · ") : fallback;
}

export function workerInviteEmail(
  data: {
    company: string | null;
    owner: string | null;
    jobTitle: string | null;
    /** The invites in the app (an existing account) or the registration link (a new person). */
    url: string | null;
    forAccount: boolean;
    /** WORKER_BILLING_VISIBLE (28.1): says the owner pays for the work. */
    billingVisible?: boolean;
    /** The rights set before the invite (30.2), said in plain words. */
    grants?: PermissionGrants | null;
  },
  locale: string | null,
): InviteEmail {
  const t = serverTranslator(locale);
  const access = data.grants
    ? accessSentences(
        data.grants,
        (key, values) => t(`workers.access.${key}` as "workers.access.always", values),
        (section) =>
          section === "invoices"
            ? t("workers.permissions.sections.invoices")
            : t(`nav.${sectionNavKey(section)}` as "nav.dashboard"),
      )
    : null;
  const list = access
    ? {
        title: t("email.workerInvite.accessTitle"),
        items: access.lines,
        after: [...(access.hidden ? [access.hidden] : []), access.always],
      }
    : null;
  const who = inviterLabel(data.company, data.owner, t("email.workerInvite.someone"));
  const intro = data.jobTitle
    ? t("email.workerInvite.introAs", { who, role: data.jobTitle, appName: APP_NAME })
    : t("email.workerInvite.intro", { who, appName: APP_NAME });
  const how = data.forAccount ? t("email.workerInvite.inApp") : t("email.workerInvite.signUp");
  const label = data.forAccount ? t("email.workerInvite.open") : t("email.workerInvite.register");
  const paragraphs = [intro, how, ...(data.billingVisible ? [t("email.workerInvite.free")] : [])];
  const accessText = list
    ? [[list.title, ...list.items.map((item) => `- ${item}`)].join("\n"), ...list.after]
    : [];
  const text = [...paragraphs, ...accessText, ...(data.url ? [`${label}: ${data.url}`] : [])].join("\n\n");
  return {
    subject: t("email.workerInvite.subject", { who, appName: APP_NAME }),
    text,
    html: render(paragraphs, data.url ? { label, url: data.url } : null, list),
  };
}

export function workerLeftEmail(
  data: { worker: string; company: string | null; url: string | null },
  locale: string | null,
): InviteEmail {
  const t = serverTranslator(locale);
  const paragraphs = [
    t("email.workerLeft.intro", { worker: data.worker, appName: APP_NAME }),
    t("email.workerLeft.next"),
  ];
  const label = t("email.workerLeft.open");
  const text = [...paragraphs, ...(data.url ? [`${label}: ${data.url}`] : [])].join("\n\n");
  return {
    subject: t("email.workerLeft.subject", { worker: data.worker, appName: APP_NAME }),
    text,
    html: render(paragraphs, data.url ? { label, url: data.url } : null),
  };
}
