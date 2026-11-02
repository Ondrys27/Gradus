"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_PATH } from "../access";
import { ADMIN_FORMAT_SETTINGS } from "../format-metric";
import { adminSubscriptionSchema, periodEndInstant, type AdminSubscriptionForm } from "../subscription-form";
import { adminAccessFor } from "./guard";
import { fingerprint, requestInfo } from "./request-info";

/**
 * One account's subscription set by hand in the administration, until a
 * payment gateway does it. The owner of the app only (aal2, live admin
 * session); the database checks it again from the signed token and writes
 * from → to into admin_audit in the same transaction.
 */

export type SubscriptionActionResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "forbidden" | "failed" };

export async function saveUserSubscription(
  userId: string,
  input: AdminSubscriptionForm,
): Promise<SubscriptionActionResult> {
  const id = z.uuid().safeParse(userId);
  const parsed = adminSubscriptionSchema.safeParse(input);
  if (!id.success || !parsed.success) return { ok: false, error: "invalid" };
  if (!(await adminAccessFor("editSubscriptions"))) return { ok: false, error: "forbidden" };

  const { ip } = await requestInfo();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_subscription_set", {
    _user_id: id.data,
    _plan_key: parsed.data.planKey,
    _billing: parsed.data.billing,
    _status: parsed.data.status,
    // The generated types miss that the end may be null (open-ended).
    _period_end: periodEndInstant(parsed.data.periodEnd, ADMIN_FORMAT_SETTINGS.timeZone) as string,
    _cancel_at_period_end: parsed.data.cancelAtPeriodEnd,
    _ip_hash: fingerprint("ip", ip),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    if (error.code === "22023") return { ok: false, error: "invalid" };
    console.error("[admin] saving a subscription failed", error.message);
    return { ok: false, error: "failed" };
  }
  revalidatePath(`${ADMIN_PATH}/uzivatele/${id.data}`);
  revalidatePath(`${ADMIN_PATH}/tarify`);
  return { ok: true };
}
