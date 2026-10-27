"use server";

import { revalidatePath } from "next/cache";
import { ERROR_ALERTS_PATH, sendTestErrorAlert } from "@/features/errors/alerts/server/dispatch";
import {
  errorAlertFormSchema,
  toStoredErrorAlerts,
  type ErrorAlertForm,
  type ErrorAlertFormProblem,
} from "@/features/errors/alerts/settings";
import { createClient } from "@/lib/supabase/server";
import { logAdminAction } from "./audit";
import { adminAccessFor } from "./guard";
import { fingerprint, requestInfo } from "./request-info";

/**
 * Settings → Error alerts. Saving checks the owner's admin session (role
 * owner, aal2) first; the database function checks it once more from the
 * signed token, saves the value and writes the change (counts and a hash of
 * the addresses, never the addresses) into admin_audit in one transaction.
 * An admin only reads the settings.
 */

export type ErrorAlertsSaveResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "forbidden" | "failed"; problems?: ErrorAlertFormProblem[] };

export async function saveErrorAlerts(input: ErrorAlertForm): Promise<ErrorAlertsSaveResult> {
  const parsed = errorAlertFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const stored = toStoredErrorAlerts(parsed.data);
  if (!stored.ok) return { ok: false, error: "invalid", problems: stored.problems };
  if (!(await adminAccessFor("editErrorAlerts"))) return { ok: false, error: "forbidden" };

  const { ip } = await requestInfo();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_app_setting", {
    _key: "error_alerts",
    _value: stored.value,
    _ip_hash: fingerprint("ip", ip),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    if (error.code === "22023") return { ok: false, error: "invalid" };
    console.error("[admin] saving error alerts failed", error.message);
    return { ok: false, error: "failed" };
  }
  revalidatePath(ERROR_ALERTS_PATH);
  return { ok: true };
}

export type ErrorAlertsTestResult =
  | { ok: true; sent: number; total: number; failure: string | null }
  | { ok: false; error: "forbidden" | "noRecipients" | "limited" | "failed" };

/** "Send a test e-mail" to the saved addresses; the owner only, a few times an hour. */
export async function sendErrorAlertsTest(): Promise<ErrorAlertsTestResult> {
  const context = await adminAccessFor("editErrorAlerts");
  if (!context) return { ok: false, error: "forbidden" };
  const result = await sendTestErrorAlert();
  if (!result.ok) return result;
  await logAdminAction(context, "update", "settings.error_alerts.test");
  return { ok: true, ...result.delivery };
}
