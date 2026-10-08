"use server";

import { z } from "zod";
import { logAdminAction } from "./audit";
import { adminAccess } from "./guard";

/** `chart.<page>.<chart>.<csv|png>`: identifiers only, never free text. */
const EXPORT_TARGET = z.string().regex(/^chart\.[a-z0-9_]{1,30}\.[a-z0-9_]{1,30}\.(csv|png)$/);

/**
 * Writes a chart export to the audit before the browser saves the file. The
 * file is built in the browser from what is already on screen, so the audit
 * row is the gate: without it, nothing is saved.
 */
export async function recordChartExport(target: string): Promise<{ ok: boolean }> {
  const parsed = EXPORT_TARGET.safeParse(target);
  if (!parsed.success) return { ok: false };
  const context = await adminAccess(true);
  if (!context) return { ok: false };
  return { ok: await logAdminAction(context, "export", parsed.data) };
}
