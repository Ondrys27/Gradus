import "server-only";
import { serverTranslator } from "@/i18n/server-translator";
import { APP_NAME } from "@/lib/constants";
import { escapeHtml } from "@/lib/email/resend";
import type { ReportKind } from "../report";

/**
 * The beta e-mails, in the reader's language: the owner's note about a new
 * report, the thank-you to an author whose report was fixed, and the welcome
 * to a tester with an invitation. Everything is escaped in the HTML part.
 */

export type EmailContent = { subject: string; text: string; html: string };

function build(
  paragraphs: string[],
  link: { label: string; href: string } | null,
): EmailContent["html"] {
  const body = paragraphs
    .map(
      (line) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapeHtml(line)}</p>`,
    )
    .join("\n");
  const button = link
    ? `<p style="margin:20px 0"><a href="${escapeHtml(link.href)}" style="background:#7C5CFF;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">${escapeHtml(link.label)}</a></p>`
    : "";
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a2e;max-width:560px">\n${body}\n${button}\n</div>`;
}

function textOf(paragraphs: string[], link: { label: string; href: string } | null): string {
  return [...paragraphs, ...(link ? ["", `${link.label}: ${link.href}`] : [])]
    .join("\n\n")
    .replace(/\n\n\n\n/g, "\n\n");
}

export type ReportMailData = {
  id: string;
  kind: ReportKind;
  description: string;
  expected: string | null;
  page: string;
  browser: string | null;
  device: string | null;
  viewport: string | null;
  locale: string | null;
  version: string | null;
  consoleCount: number;
  screenshot: boolean;
  user: { name: string | null; email: string | null };
  adminUrl: string | null;
};

/** "[Gradus] Nápad: …" with the report in full and a link to its detail. */
export function reportOwnerEmail(data: ReportMailData, locale: string | null): EmailContent {
  const t = serverTranslator(locale);
  const kind = t(`email.bugReport.kind.${data.kind}` as never);
  const who = [data.user.name, data.user.email].filter(Boolean).join(" · ") || "–";
  const technical = [data.browser, data.device, data.viewport].filter(Boolean).join(" · ") || "–";
  const summary = data.description.replace(/\s+/g, " ").slice(0, 70);
  const paragraphs = [
    t("email.bugReport.intro", { appName: APP_NAME, kind }),
    `${t("email.bugReport.from")}: ${who}`,
    `${t("email.bugReport.what")}: ${data.description}`,
    ...(data.expected ? [`${t("email.bugReport.expected")}: ${data.expected}`] : []),
    `${t("email.bugReport.page")}: ${data.page}`,
    `${t("email.bugReport.browser")}: ${technical} · ${data.locale ?? "–"} · ${data.version ?? "–"}`,
    t("email.bugReport.extras", {
      count: data.consoleCount,
      screenshot: data.screenshot ? "1" : "0",
    }),
  ];
  const link = data.adminUrl ? { label: t("email.bugReport.open"), href: data.adminUrl } : null;
  return {
    subject: t("email.bugReport.subject", { prefix: `[${APP_NAME}]`, kind, summary }),
    text: textOf(paragraphs, link),
    html: build(paragraphs, link),
  };
}

/** A short thank-you once a report became fixed. */
export function reportFixedEmail(
  data: { appUrl: string | null },
  locale: string | null,
): EmailContent {
  const t = serverTranslator(locale);
  const paragraphs = [t("email.bugFixed.hello"), t("email.bugFixed.body", { appName: APP_NAME })];
  const link = data.appUrl
    ? { label: t("email.bugFixed.open", { appName: APP_NAME }), href: data.appUrl }
    : null;
  return {
    subject: t("email.bugFixed.subject", { appName: APP_NAME }),
    text: textOf(paragraphs, link),
    html: build(paragraphs, link),
  };
}

/** Thanks, what the beta is in three sentences, how to report a problem, a link into the app. */
export function welcomeBetaEmail(
  data: { name: string | null; appUrl: string | null },
  locale: string | null,
): EmailContent {
  const t = serverTranslator(locale);
  const paragraphs = [
    data.name
      ? t("email.welcomeBeta.helloNamed", { name: data.name })
      : t("email.welcomeBeta.hello"),
    t("email.welcomeBeta.thanks", { appName: APP_NAME }),
    t("email.welcomeBeta.what1", { appName: APP_NAME }),
    t("email.welcomeBeta.what2"),
    t("email.welcomeBeta.what3"),
    t("email.welcomeBeta.report"),
  ];
  const link = data.appUrl
    ? { label: t("email.welcomeBeta.open", { appName: APP_NAME }), href: data.appUrl }
    : null;
  return {
    subject: t("email.welcomeBeta.subject", { appName: APP_NAME }),
    text: textOf(paragraphs, link),
    html: build(paragraphs, link),
  };
}
