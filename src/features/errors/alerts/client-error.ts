import { z } from "zod";
import { locales } from "@/i18n/locales";
import { ERROR_CODE_PATTERN } from "../error-code";

/**
 * The record of an error the browser caught, as it sends it to
 * POST /api/client-error: the code, how it was caught, the page, the
 * scrubbed message and the first frames of the stack, Next.js's digest, the
 * window, the language, the version. The user comes from the session and the
 * browser class from the User-Agent, never from the body; the server scrubs
 * the text again.
 */

export const CLIENT_ERROR_ENDPOINT = "/api/client-error";
export const CLIENT_ERROR_SOURCES = ["boundary", "onerror", "unhandledrejection"] as const;
export type ClientErrorSource = (typeof CLIENT_ERROR_SOURCES)[number];

/** Errors per hour one browser may record: of an account, and anonymously of one address. */
export const CLIENT_ERROR_LIMIT_USER = 30;
export const CLIENT_ERROR_LIMIT_ANONYMOUS = 10;
export const CLIENT_ERROR_MAX_BODY_BYTES = 16 * 1024;

export const clientErrorSchema = z.strictObject({
  code: z.string().regex(ERROR_CODE_PATTERN),
  source: z.enum(CLIENT_ERROR_SOURCES),
  page: z.string().min(1).max(2000),
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  digest: z
    .string()
    .regex(/^[A-Za-z0-9_@-]{1,64}$/)
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

export type ClientErrorInput = z.input<typeof clientErrorSchema>;
