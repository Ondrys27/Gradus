"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "./audit";
import { adminAccess } from "./guard";
import { setUserInternal } from "./users-data";
import { runInBackground } from "@/features/errors/alerts/server/background";
import { mailAuthorReportFixed } from "@/features/feedback/server/notify";
import { track } from "@/lib/analytics/track";
import { siteOrigin } from "@/lib/site-origin";
import {
  BUG_REPORT_STATUSES,
  FEATURE_REQUEST_STATUSES,
  type BugReportStatus,
  type FeatureRequestStatus,
} from "../types";

/**
 * The few edits the administration makes itself, each written to the audit
 * as 'update'. Everything else the administration shows is read-only.
 */

const userIdSchema = z.uuid();

export async function toggleUserInternal(
  userId: string,
  internal: boolean,
): Promise<{ ok: boolean }> {
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) return { ok: false };
  const context = await adminAccess(true);
  if (!context) return { ok: false };
  await setUserInternal(parsed.data, internal);
  await logAdminAction(context, "update", "users.internal");
  return { ok: true };
}

const featureRequestStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(FEATURE_REQUEST_STATUSES as [FeatureRequestStatus, ...FeatureRequestStatus[]]),
});

export async function setFeatureRequestStatus(
  id: string,
  status: FeatureRequestStatus,
): Promise<{ ok: boolean }> {
  const parsed = featureRequestStatusSchema.safeParse({ id, status });
  if (!parsed.success) return { ok: false };
  const context = await adminAccess(true);
  if (!context) return { ok: false };
  const { error } = await createAdminClient()
    .from("feature_requests")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id);
  if (error) return { ok: false };
  await logAdminAction(context, "update", "feedback.status");
  return { ok: true };
}

const bugReportStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(BUG_REPORT_STATUSES as unknown as [BugReportStatus, ...BugReportStatus[]]),
});

/**
 * Moves a report to another status. When it becomes fixed for the first time,
 * the database hands back its author (once) and the author gets a short thank-you.
 */
export async function setBugReportStatus(
  id: string,
  status: BugReportStatus,
): Promise<{ ok: boolean }> {
  const parsed = bugReportStatusSchema.safeParse({ id, status });
  if (!parsed.success) return { ok: false };
  const context = await adminAccess(true);
  if (!context) return { ok: false };
  const admin = createAdminClient();
  const { data: author, error } = await admin.rpc("admin_bug_report_set_status", {
    _id: parsed.data.id,
    _status: parsed.data.status,
  });
  if (error) return { ok: false };
  await logAdminAction(context, "update", "feedback.report");
  const origin = author ? await siteOrigin().catch(() => null) : null;
  runInBackground("report-fixed", async () => {
    const notified = author ? await mailAuthorReportFixed(admin, author, origin) : false;
    await track(
      "bug_report_status_changed",
      { status: parsed.data.status, notified },
      { userId: context.userId, admin },
    );
  });
  return { ok: true };
}
