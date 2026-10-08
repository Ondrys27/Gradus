"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "./audit";
import { adminAccess } from "./guard";
import { setUserInternal } from "./users-data";
import { FEATURE_REQUEST_STATUSES, type FeatureRequestStatus } from "../types";

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
