import { z } from "zod";
import { locales } from "@/i18n/locales";
import { REPORT_KINDS, REPORT_TEXT_MAX, type ReportKind } from "./report";

/**
 * The public support form (/podpora, /en/support; 27.1): signed in or not,
 * into the same bug reports as "Report a problem" (source support). The user
 * comes from the session; signed out, the hourly limit is per address (a
 * keyed hash, never the address). An optional e-mail to be answered at; an
 * empty hidden field catches simple bots.
 */

export const SUPPORT_ENDPOINT = "/api/support";
/** Requests an address may send per hour while signed out. */
export const SUPPORT_LIMIT_ANONYMOUS = 5;
/** Requests an account may send per hour (the same as the report dialog). */
export const SUPPORT_LIMIT_USER = 20;
export const SUPPORT_MAX_BODY_BYTES = 16 * 1024;
/** The page the request is filed under in the administration. */
export const SUPPORT_PAGE = "/podpora";

export const supportSchema = z.strictObject({
  kind: z.enum(REPORT_KINDS),
  description: z.string().trim().min(1).max(REPORT_TEXT_MAX),
  expected: z.string().max(REPORT_TEXT_MAX).optional(),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((value) => value === "" || z.email().safeParse(value).success)
    .optional(),
  locale: z.enum(locales).optional(),
  viewport: z
    .string()
    .regex(/^\d{1,5}x\d{1,5}$/)
    .optional(),
  /** The honeypot: a person never sees it, so it stays empty. */
  website: z.string().max(200).optional(),
});

export type SupportInput = z.input<typeof supportSchema>;

export type PreparedSupport = {
  kind: ReportKind;
  description: string;
  expected: string | null;
  email: string | null;
  locale: string | null;
  viewport: string | null;
};

export type SupportDeps = {
  userId: string | null;
  /** Stores the request (bug_report_support); null = the hourly limit is reached. */
  store: (request: PreparedSupport) => Promise<string | null>;
  /** Analytics and the owner's e-mail, once it is stored. */
  afterStored: (request: PreparedSupport, id: string) => void;
};

export type SupportResult = {
  status: 200 | 400 | 429;
  body: { ok: true } | { error: "invalid" | "limited" };
};

export async function submitSupport(payload: unknown, deps: SupportDeps): Promise<SupportResult> {
  const parsed = supportSchema.safeParse(payload);
  if (!parsed.success) return { status: 400, body: { error: "invalid" } };
  // A filled honeypot gets the same answer as a person, and nothing is stored.
  if (parsed.data.website?.trim()) return { status: 200, body: { ok: true } };
  const request: PreparedSupport = {
    kind: parsed.data.kind,
    description: parsed.data.description.trim(),
    expected: parsed.data.expected?.trim() || null,
    email: parsed.data.email?.trim().toLowerCase() || null,
    locale: parsed.data.locale ?? null,
    viewport: parsed.data.viewport ?? null,
  };
  const id = await deps.store(request);
  if (!id) return { status: 429, body: { error: "limited" } };
  deps.afterStored(request, id);
  return { status: 200, body: { ok: true } };
}
