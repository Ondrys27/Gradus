import { createTranslator } from "next-intl";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { APP_NAME } from "@/lib/constants";
import { APP_HOME_PATH, localizedPath, type SiteLocale } from "@/lib/routes";

/**
 * The Supabase Auth e-mails (confirm sign-up, reset password, change e-mail)
 * in Gradus's look, built from the translations. They are pasted into
 * Supabase → Authentication → Emails by hand (docs/supabase-email.md), so
 * `bun scripts/email-templates.ts` writes them to docs/email-templates/ and a
 * test keeps those files in step with this code.
 *
 * Supabase fills Go template fields: `{{ .SiteURL }}`, `{{ .TokenHash }}`,
 * `{{ .Email }}`, `{{ .NewEmail }}` and `{{ .Data }}` (the user's metadata,
 * where sign-up stores `locale`). One template per kind serves both
 * languages: English when `.Data.locale` is "en", otherwise Czech. Links go to
 * /auth/confirm with the token hash, which works in any browser.
 */

export const AUTH_TEMPLATE_KINDS = ["confirmSignup", "resetPassword", "changeEmail"] as const;
export type AuthTemplateKind = (typeof AUTH_TEMPLATE_KINDS)[number];

/** File names in docs/email-templates and the Supabase template each one goes to. */
export const AUTH_TEMPLATE_FILES: Record<AuthTemplateKind, { file: string; supabase: string }> = {
  confirmSignup: { file: "confirm-signup", supabase: "Confirm signup" },
  resetPassword: { file: "reset-password", supabase: "Reset Password" },
  changeEmail: { file: "change-email", supabase: "Change Email Address" },
};

/** Email clients know no CSS variables: the theme tokens of globals.css, written out. */
const PALETTE = {
  canvas: "#070B1F",
  card: "#0D1234",
  line: "#2A3468",
  violet: "#7C5CFF",
  teal: "#2FE3C8",
  ink: "#FFFFFF",
  inkSoft: "#AEB8DE",
  inkMuted: "#8892BE",
} as const;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** `type` for verifyOtp in /auth/confirm and where the link lands afterwards. */
function confirmLink(kind: AuthTemplateKind, locale: SiteLocale): string {
  const target = {
    confirmSignup: { type: "email", next: APP_HOME_PATH },
    resetPassword: { type: "recovery", next: localizedPath("resetPassword", locale) },
    changeEmail: { type: "email_change", next: APP_HOME_PATH },
  }[kind];
  return `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${target.type}&amp;next=${target.next}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function translator(locale: SiteLocale) {
  return createTranslator({
    locale,
    messages: (locale === "en" ? en : cs) as typeof en,
    namespace: "email.auth",
  });
}

/** Values the texts may use; Supabase fills the Go fields when it sends. */
const VALUES = { appName: APP_NAME, oldEmail: "{{ .Email }}", newEmail: "{{ .NewEmail }}" };

type TextValues = { appName: string; oldEmail: string; newEmail: string };

export function authTemplateSubject(kind: AuthTemplateKind, locale: SiteLocale): string {
  return translator(locale)(`${kind}.subject`, VALUES);
}

/** The e-mail in one language, a full HTML document. */
export function authTemplateHtml(kind: AuthTemplateKind, locale: SiteLocale): string {
  return renderHtml(kind, locale, confirmLink(kind, locale), VALUES);
}

/**
 * The same e-mail with a real link and real addresses, for the e-mails the
 * server sends itself through Resend (the administration's password reset,
 * a new confirmation link, a changed e-mail): it looks exactly like the one
 * Supabase sends, the link is escaped here.
 */
export function authEmail(
  kind: AuthTemplateKind,
  locale: SiteLocale,
  link: string,
  addresses: { oldEmail?: string; newEmail?: string } = {},
): { subject: string; html: string; text: string } {
  const values: TextValues = {
    appName: APP_NAME,
    oldEmail: addresses.oldEmail ?? "",
    newEmail: addresses.newEmail ?? "",
  };
  const t = translator(locale);
  const text = [
    t(`${kind}.heading`, values),
    t(`${kind}.body`, values),
    `${t(`${kind}.button`, values)}: ${link}`,
    t(`${kind}.ignore`, values),
    t("footer", values),
  ].join("\n\n");
  return {
    subject: t(`${kind}.subject`, values),
    html: renderHtml(kind, locale, escapeHtml(link), values),
    text,
  };
}

/** `link` is already safe inside an attribute (escaped, or the Go template fields). */
function renderHtml(
  kind: AuthTemplateKind,
  locale: SiteLocale,
  link: string,
  values: TextValues,
): string {
  const t = translator(locale);
  const text = (key: "preheader" | "heading" | "body" | "button" | "ignore") =>
    escapeHtml(t(`${kind}.${key}`, values));
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(t(`${kind}.subject`, values))}</title>
</head>
<body style="margin:0;padding:0;background-color:${PALETTE.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${text("preheader")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PALETTE.canvas};">
<tr>
<td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr>
<td style="padding:0 4px 20px;font-family:${FONT};">
<span style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${PALETTE.ink};">${APP_NAME}</span><span style="font-size:22px;font-weight:800;color:${PALETTE.teal};">.</span>
<span style="font-size:13px;color:${PALETTE.inkMuted};padding-left:8px;">${escapeHtml(t("tagline"))}</span>
</td>
</tr>
<tr>
<td style="background-color:${PALETTE.card};border:1px solid ${PALETTE.line};border-radius:20px;padding:36px 32px;font-family:${FONT};">
<div style="height:4px;width:56px;border-radius:4px;background-color:${PALETTE.violet};background-image:linear-gradient(90deg,${PALETTE.violet},${PALETTE.teal});margin:0 0 24px;"></div>
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;color:${PALETTE.ink};">${text("heading")}</h1>
<p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:${PALETTE.inkSoft};">${text("body")}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="border-radius:12px;background-color:${PALETTE.violet};">
<a href="${link}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;font-weight:700;color:${PALETTE.ink};text-decoration:none;border-radius:12px;">${text("button")}</a>
</td>
</tr>
</table>
<p style="margin:28px 0 6px;font-size:13px;line-height:1.5;color:${PALETTE.inkMuted};">${escapeHtml(t("fallback"))}</p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${link}" style="color:${PALETTE.teal};text-decoration:underline;">${link}</a></p>
<p style="margin:0;padding-top:20px;border-top:1px solid ${PALETTE.line};font-size:13px;line-height:1.5;color:${PALETTE.inkMuted};">${text("ignore")}</p>
</td>
</tr>
<tr>
<td style="padding:20px 4px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${PALETTE.inkMuted};">${escapeHtml(t("footer", values))}</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
`;
}

/**
 * What goes into Supabase: English for accounts whose metadata says "en",
 * Czech for everyone else (`with` keeps an account without `locale` from
 * breaking the template).
 */
const LOCALE_SWITCH = `{{ $en := false }}{{ with .Data.locale }}{{ if eq . "en" }}{{ $en = true }}{{ end }}{{ end }}`;

export function authTemplateSupabaseHtml(kind: AuthTemplateKind): string {
  return `${LOCALE_SWITCH}{{ if $en }}${authTemplateHtml(kind, "en")}{{ else }}${authTemplateHtml(kind, "cs")}{{ end }}\n`;
}

export function authTemplateSupabaseSubject(kind: AuthTemplateKind): string {
  return `${LOCALE_SWITCH}{{ if $en }}${authTemplateSubject(kind, "en")}{{ else }}${authTemplateSubject(kind, "cs")}{{ end }}`;
}

/** Every file of docs/email-templates by name. */
export function authTemplateFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const kind of AUTH_TEMPLATE_KINDS) {
    const name = AUTH_TEMPLATE_FILES[kind].file;
    files[`${name}.html`] = authTemplateSupabaseHtml(kind);
    files[`${name}.cs.html`] = authTemplateHtml(kind, "cs");
    files[`${name}.en.html`] = authTemplateHtml(kind, "en");
  }
  files["subjects.txt"] = AUTH_TEMPLATE_KINDS.map(
    (kind) =>
      `${AUTH_TEMPLATE_FILES[kind].supabase}\n${authTemplateSupabaseSubject(kind)}\n` +
      `cs: ${authTemplateSubject(kind, "cs")}\nen: ${authTemplateSubject(kind, "en")}\n`,
  ).join("\n");
  return files;
}
