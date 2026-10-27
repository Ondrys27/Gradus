import "server-only";
import { serverTranslator } from "@/i18n/server-translator";
import { APP_NAME } from "@/lib/constants";
import { escapeHtml } from "@/lib/email/resend";
import {
  DEFAULT_FORMAT_SETTINGS,
  formatDateTime,
  formatNumber,
  type FormatSettings,
} from "@/lib/format";
import { ERROR_ALERT_LIMITS } from "./settings";

/**
 * The e-mails about errors, in the owner's language. Only what the error
 * record holds (code, page, scrubbed message, stack frames, browser class,
 * version) and who it happened to (name, e-mail, id, plan, internal) — never
 * anything of the person's data. Every value is escaped in the HTML part.
 */

export type EmailContent = { subject: string; text: string; html: string };

export type AlertEvent = {
  code: string;
  source: string;
  page: string;
  action: string | null;
  message: string;
  stack: string | null;
  browser: string | null;
  device: string | null;
  viewport: string | null;
  appVersion: string | null;
  createdAt: string;
};

export type AlertUser = {
  id: string;
  name: string | null;
  email: string | null;
  plan: string | null;
  planStatus: string | null;
  internal: boolean;
};

export type ErrorAlertData = {
  event: AlertEvent;
  /** Null: nobody was signed in. */
  user: AlertUser | null;
  /** The same error in the last 24 hours, this one included. */
  dayCount: number;
  /** Occurrences held back since the last e-mail about it, counted into this one. */
  sinceLast: number;
  /** The administration's page of this error; null when the site's address is unknown. */
  adminUrl: string | null;
};

export type DigestGroup = {
  code: string;
  page: string;
  source: string;
  action: string | null;
  message: string;
  n: number;
  users: number;
  last_at: string;
};

const PRAGUE: FormatSettings = {
  ...DEFAULT_FORMAT_SETTINGS,
  timeZone: "Europe/Prague",
  timeFormat: "HH:mm:ss",
};
const UTC: FormatSettings = { ...PRAGUE, timeZone: "UTC" };

type Line = { label: string; value: string; pre?: boolean; href?: boolean };

function render(intro: string, lines: Line[], outro: string[]): { text: string; html: string } {
  const text = [
    intro,
    "",
    ...lines.map((line) =>
      line.pre ? `${line.label}:\n${line.value}` : `${line.label}: ${line.value}`,
    ),
    "",
    ...outro,
  ].join("\n");
  const rows = lines
    .map((line) => {
      const value = line.pre
        ? `<pre style="margin:0;white-space:pre-wrap;font-size:12px">${escapeHtml(line.value)}</pre>`
        : line.href
          ? `<a href="${escapeHtml(line.value)}">${escapeHtml(line.value)}</a>`
          : escapeHtml(line.value);
      return `<tr><th align="left" valign="top" style="padding:4px 12px 4px 0;white-space:nowrap">${escapeHtml(line.label)}</th><td style="padding:4px 0">${value}</td></tr>`;
    })
    .join("\n");
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">\n${rows}\n</table>`,
    ...outro.map((line) => `<p style="color:gray;font-size:12px">${escapeHtml(line)}</p>`),
  ].join("\n");
  return { text, html };
}

function translatorFor(locale: string | null | undefined) {
  const t = serverTranslator(locale);
  const label = (group: "source" | "browser" | "device", key: string | null): string | null => {
    if (!key) return null;
    const path =
      group === "source"
        ? `email.errorAlert.source.${key}`
        : group === "browser"
          ? `admin.feedback.browser.${key}`
          : `admin.controls.segmentValues.device.${key}`;
    return t.has(path as never) ? t(path as never) : key;
  };
  return { t, label };
}

const count = (value: number) => formatNumber(value, {}, DEFAULT_FORMAT_SETTINGS);

/** "[Gradus] Chyba GR-7K3M9Q · /app/finance" and the error in full. */
export function errorAlertEmail(data: ErrorAlertData, locale: string | null): EmailContent {
  const { t, label } = translatorFor(locale);
  const { event, user } = data;
  const at = new Date(event.createdAt);
  const prefix = `[${APP_NAME}]`;

  const who = user
    ? [
        user.name || t("email.errorAlert.unnamed"),
        user.email,
        user.id,
        t("email.errorAlert.plan", {
          plan: user.plan ?? "–",
          status: user.planStatus ?? "–",
        }),
        user.internal ? t("email.errorAlert.internalYes") : t("email.errorAlert.internalNo"),
      ]
        .filter(Boolean)
        .join(" · ")
    : t("email.errorAlert.anonymous");
  const browser = [label("browser", event.browser), label("device", event.device), event.viewport]
    .filter(Boolean)
    .join(" · ");
  const occurrences =
    data.sinceLast > 0
      ? t("email.errorAlert.countSince", {
          count: count(data.dayCount),
          since: count(data.sinceLast),
          minutes: ERROR_ALERT_LIMITS.fingerprintMinutes,
        })
      : t("email.errorAlert.count", { count: count(data.dayCount) });

  const lines: Line[] = [
    { label: t("email.errorAlert.code"), value: event.code },
    {
      label: t("email.errorAlert.time"),
      value: t("email.errorAlert.timeValue", {
        prague: formatDateTime(at, PRAGUE),
        utc: formatDateTime(at, UTC),
      }),
    },
    { label: t("email.errorAlert.page"), value: event.page },
    {
      label: t("email.errorAlert.action"),
      value: [label("source", event.source), event.action].filter(Boolean).join(" · "),
    },
    { label: t("email.errorAlert.message"), value: event.message },
    ...(event.stack ? [{ label: t("email.errorAlert.stack"), value: event.stack, pre: true }] : []),
    { label: t("email.errorAlert.user"), value: who },
    ...(browser ? [{ label: t("email.errorAlert.browser"), value: browser }] : []),
    { label: t("email.errorAlert.version"), value: event.appVersion ?? "–" },
    { label: t("email.errorAlert.occurrences"), value: occurrences },
    ...(data.adminUrl
      ? [{ label: t("email.errorAlert.link"), value: data.adminUrl, href: true }]
      : []),
  ];

  return {
    subject: t("email.errorAlert.subject", { prefix, code: event.code, page: event.page }),
    ...render(t("email.errorAlert.intro", { appName: APP_NAME }), lines, [
      t("email.errorAlert.rules", {
        minutes: ERROR_ALERT_LIMITS.fingerprintMinutes,
        perHour: ERROR_ALERT_LIMITS.perHour,
      }),
      t("email.errorAlert.settings"),
    ]),
  };
}

/** The one e-mail when the hourly limit is reached: look in the administration. */
export function overflowAlertEmail(
  data: { adminUrl: string | null },
  locale: string | null,
): EmailContent {
  const { t } = translatorFor(locale);
  const prefix = `[${APP_NAME}]`;
  const lines: Line[] = data.adminUrl
    ? [{ label: t("email.errorAlert.link"), value: data.adminUrl, href: true }]
    : [];
  return {
    subject: t("email.errorAlert.overflowSubject", { prefix }),
    ...render(t("email.errorAlert.overflowIntro", { perHour: ERROR_ALERT_LIMITS.perHour }), lines, [
      t("email.errorAlert.settings"),
    ]),
  };
}

/** The daily summary of the digest mode: each error once, with how often it happened. */
export function digestAlertEmail(
  data: { groups: DigestGroup[]; total: number; adminUrl: string | null },
  locale: string | null,
): EmailContent {
  const { t, label } = translatorFor(locale);
  const prefix = `[${APP_NAME}]`;
  const lines: Line[] = data.groups.map((group) => ({
    label: t("email.errorAlert.digestTimes", { count: count(group.n) }),
    value: [
      group.code,
      group.page,
      [label("source", group.source), group.action].filter(Boolean).join(" "),
      group.message,
      t("email.errorAlert.digestLast", {
        time: formatDateTime(new Date(group.last_at), PRAGUE),
        users: count(group.users),
      }),
    ].join(" · "),
  }));
  if (data.adminUrl) {
    lines.push({ label: t("email.errorAlert.link"), value: data.adminUrl, href: true });
  }
  return {
    subject: t("email.errorAlert.digestSubject", { prefix, count: count(data.total) }),
    ...render(
      t("email.errorAlert.digestIntro", {
        count: data.total,
        errors: count(data.groups.length),
      }),
      lines,
      [t("email.errorAlert.settings")],
    ),
  };
}

/** "Poslat zkušební e-mail" in the administration. */
export function testAlertEmail(
  data: { emails: string[]; adminUrl: string | null },
  locale: string | null,
): EmailContent {
  const { t } = translatorFor(locale);
  const prefix = `[${APP_NAME}]`;
  const lines: Line[] = [
    { label: t("email.errorAlert.recipients"), value: data.emails.join(", ") },
  ];
  if (data.adminUrl) {
    lines.push({ label: t("email.errorAlert.settingsLink"), value: data.adminUrl, href: true });
  }
  return {
    subject: t("email.errorAlert.testSubject", { prefix }),
    ...render(t("email.errorAlert.testIntro", { appName: APP_NAME }), lines, [
      t("email.errorAlert.settings"),
    ]),
  };
}
