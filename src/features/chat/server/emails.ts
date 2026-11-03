import "server-only";
import { serverTranslator } from "@/i18n/server-translator";
import { APP_NAME } from "@/lib/constants";
import { escapeHtml } from "@/lib/email/resend";

/**
 * The e-mail about what waits in Messages: who wrote directly and where the
 * reader was mentioned, as counts. Never the text of a message: it stays in
 * the app.
 */

export type ChatDigestLine =
  | { kind: "direct"; name: string | null; messages: number; mentions: number }
  | { kind: "group"; name: string | null; mentions: number };

export type ChatDigestEmail = { subject: string; text: string; html: string };

export function chatDigestEmail(
  lines: readonly ChatDigestLine[],
  data: { appUrl: string | null; settingsUrl: string | null },
  locale: string | null,
): ChatDigestEmail {
  const t = serverTranslator(locale);
  const someone = t("email.chat.someone");
  const items = lines.map((line) =>
    line.kind === "direct"
      ? line.mentions > 0
        ? t("email.chat.directWithMentions", {
            name: line.name ?? someone,
            messages: line.messages,
            mentions: line.mentions,
          })
        : t("email.chat.direct", { name: line.name ?? someone, messages: line.messages })
      : t("email.chat.group", { name: line.name ?? someone, mentions: line.mentions }),
  );
  const intro = t("email.chat.intro", { appName: APP_NAME });
  const outro = t("email.chat.outro");
  const open = t("email.chat.open");
  const off = t("email.chat.turnOff");

  const text = [
    intro,
    "",
    ...items.map((item) => `• ${item}`),
    "",
    outro,
    ...(data.appUrl ? ["", `${open}: ${data.appUrl}`] : []),
    ...(data.settingsUrl ? ["", `${off}: ${data.settingsUrl}`] : []),
  ].join("\n");

  const list = items
    .map((item) => `<li style="margin:0 0 6px">${escapeHtml(item)}</li>`)
    .join("\n");
  const button = data.appUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(data.appUrl)}" style="background:#7C5CFF;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600">${escapeHtml(open)}</a></p>`
    : "";
  const footer = data.settingsUrl
    ? `<p style="margin:16px 0 0;font-size:13px;color:#6b6b80"><a href="${escapeHtml(data.settingsUrl)}" style="color:#6b6b80">${escapeHtml(off)}</a></p>`
    : "";
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a2e;max-width:560px">
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapeHtml(intro)}</p>
<ul style="margin:0 0 12px;padding-left:20px;font-size:15px;line-height:1.5">
${list}
</ul>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${escapeHtml(outro)}</p>
${button}
${footer}
</div>`;

  return { subject: t("email.chat.subject", { appName: APP_NAME }), text, html };
}
