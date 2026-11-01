import { z } from "zod";
import { locales } from "@/i18n/locales";
import { reportPage } from "@/features/errors/report";
import { scrubMessage } from "@/lib/analytics/scrub";

/**
 * The "Report a problem" dialog's report, as it is sent to POST
 * /api/report-problem. The user comes from the session and the browser class
 * from the User-Agent, never from the body; the page is cleaned and every
 * console line scrubbed again on the server, whatever the browser did.
 */

export const REPORT_ENDPOINT = "/api/report-problem";
export const REPORT_KINDS = ["bug", "idea", "confusing"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_TEXT_MAX = 2000;
export const REPORT_CONSOLE_MAX = 20;
export const REPORT_CONSOLE_LINE_MAX = 200;
/** A screenshot as a JPEG: 1.5 MB at most (the bucket's limit). */
export const REPORT_SCREENSHOT_MAX_BYTES = 1_500_000;
/** Reports an account may send per hour. */
export const REPORT_LIMIT_USER = 20;
/** The whole body, a screenshot as base64 included. */
export const REPORT_MAX_BODY_BYTES = 2_200_000;

export const CONSOLE_KINDS = ["console", "error", "rejection"] as const;
export type ConsoleKind = (typeof CONSOLE_KINDS)[number];
export type ConsoleEntry = { at: string; kind: ConsoleKind; message: string };

const consoleEntrySchema = z.strictObject({
  at: z.iso.datetime(),
  kind: z.enum(CONSOLE_KINDS),
  message: z.string().max(1000),
});

const SCREENSHOT_PREFIX = "data:image/jpeg;base64,";

export const reportSchema = z.strictObject({
  kind: z.enum(REPORT_KINDS),
  description: z.string().trim().min(1).max(REPORT_TEXT_MAX),
  expected: z.string().max(REPORT_TEXT_MAX).optional(),
  page: z.string().min(1).max(2000),
  viewport: z
    .string()
    .regex(/^\d{1,5}x\d{1,5}$/)
    .optional(),
  locale: z.enum(locales).optional(),
  version: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,40}$/)
    .optional(),
  consoleErrors: z.array(consoleEntrySchema).max(100).optional(),
  screenshot: z
    .string()
    .startsWith(SCREENSHOT_PREFIX)
    .max(Math.ceil((REPORT_SCREENSHOT_MAX_BYTES * 4) / 3) + SCREENSHOT_PREFIX.length + 8)
    .optional(),
});

export type ReportInput = z.input<typeof reportSchema>;

/** The last 20 console lines, each scrubbed the way analytics scrubs an error message. */
export function cleanConsoleErrors(entries: readonly ConsoleEntry[] | undefined): ConsoleEntry[] {
  return (entries ?? []).slice(-REPORT_CONSOLE_MAX).map((entry) => ({
    at: entry.at,
    kind: entry.kind,
    message: scrubMessage(entry.message).slice(0, REPORT_CONSOLE_LINE_MAX),
  }));
}

/** The decoded JPEG when the data URL really holds one within the size limit, else null. */
export function decodeScreenshot(dataUrl: string | undefined): Buffer | null {
  if (!dataUrl?.startsWith(SCREENSHOT_PREFIX)) return null;
  const bytes = Buffer.from(dataUrl.slice(SCREENSHOT_PREFIX.length), "base64");
  if (bytes.byteLength < 4 || bytes.byteLength > REPORT_SCREENSHOT_MAX_BYTES) return null;
  // The type is the content's: a JPEG starts FF D8 FF and ends FF D9.
  const isJpeg =
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.byteLength - 2] === 0xff &&
    bytes[bytes.byteLength - 1] === 0xd9;
  return isJpeg ? bytes : null;
}

export function prepareReport(input: z.output<typeof reportSchema>) {
  return {
    kind: input.kind,
    description: input.description.trim(),
    expected: input.expected?.trim() || null,
    page: reportPage(input.page),
    viewport: input.viewport ?? null,
    locale: input.locale ?? null,
    version: input.version ?? null,
    consoleErrors: cleanConsoleErrors(input.consoleErrors),
    screenshot: decodeScreenshot(input.screenshot),
    screenshotRejected: Boolean(input.screenshot) && !decodeScreenshot(input.screenshot),
  };
}

export type PreparedReport = ReturnType<typeof prepareReport>;
