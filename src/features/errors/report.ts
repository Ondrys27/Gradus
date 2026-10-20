import { z } from "zod";
import { locales } from "@/i18n/locales";
import { isScrubbed } from "@/lib/analytics/fields";
import { scrubMessage } from "@/lib/analytics/scrub";
import { ERROR_CODE_PATTERN } from "./error-code";

/**
 * The bug report the error page sends to POST /api/bug-report. Everything in
 * it is technical: the error code, the page (ids and tokens taken out), the
 * error's scrubbed text and digest, the window size, the language, the
 * version, and what the person chose to write. The user comes from the
 * session and the browser from the request's User-Agent, never from the body.
 */

export const BUG_REPORT_ENDPOINT = "/api/bug-report";
/** Characters of the optional description. */
export const BUG_REPORT_DESCRIPTION_MAX = 2000;
/** Reports per hour: of one account, and anonymous ones of one address. */
export const BUG_REPORT_LIMIT_USER = 20;
export const BUG_REPORT_LIMIT_ANONYMOUS = 5;

const PAGE_MAX = 300;
const ID_LIKE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{3,}|[A-Za-z0-9_-]{20,})$/i;

/**
 * The page of an error without anything that identifies a row or carries a
 * secret: segments that look like an id, a number or a token (an invitation
 * link) become `:id`. No query string, no hash.
 */
export function reportPage(pathname: string): string {
  const path = (pathname || "/").split(/[?#]/)[0] || "/";
  const cleaned = path
    .split("/")
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // Keep the raw segment; the checks below still apply.
      }
      return ID_LIKE.test(decoded) || decoded.includes("@") ? ":id" : segment;
    })
    .join("/");
  const page = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  return page.length > PAGE_MAX ? page.slice(0, PAGE_MAX) : page;
}

export const bugReportSchema = z.strictObject({
  code: z.string().regex(ERROR_CODE_PATTERN),
  page: z.string().min(1).max(2000),
  description: z.string().max(BUG_REPORT_DESCRIPTION_MAX).optional(),
  message: z.string().max(2000).optional(),
  digest: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  viewport: z
    .string()
    .regex(/^\d{1,5}x\d{1,5}$/)
    .optional(),
  locale: z.enum(locales).optional(),
  version: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,40}$/)
    .optional(),
});

export type BugReportInput = z.input<typeof bugReportSchema>;

/** The report as it is stored: the page cleaned, the message scrubbed again, the text trimmed. */
export function prepareBugReport(input: z.output<typeof bugReportSchema>) {
  const message = input.message ? scrubMessage(input.message) : null;
  const description = input.description?.trim() || null;
  return {
    code: input.code,
    page: reportPage(input.page),
    description,
    message: message && isScrubbed(message) ? message : null,
    digest: input.digest ?? null,
    viewport: input.viewport ?? null,
    locale: input.locale ?? null,
    version: input.version ?? null,
  };
}

export type PreparedBugReport = ReturnType<typeof prepareBugReport>;
