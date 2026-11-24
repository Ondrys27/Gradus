"use server";

import { revalidatePath } from "next/cache";
import { validRetention } from "@/features/trash/trash";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_PATH } from "../access";
import { adminAccessFor } from "./guard";
import { fingerprint, requestInfo } from "./request-info";

/**
 * Administration → AI and Grady → Rules: how many days the trash keeps what
 * Grady and connected apps (MCP) deleted (28.8, app_settings.trash_retention,
 * 7 without a row; notes keep their own 30 days). The owner or a full admin
 * with aal2; the database checks the value and audits the change.
 */
export async function saveTrashRetention(
  days: number,
): Promise<{ ok: true } | { ok: false; error: "forbidden" | "invalid" | "failed" }> {
  if (!validRetention(days)) return { ok: false, error: "invalid" };
  if (!(await adminAccessFor("editGradyRules"))) return { ok: false, error: "forbidden" };
  const { ip } = await requestInfo();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_app_setting", {
    _key: "trash_retention",
    _value: { days },
    _ip_hash: fingerprint("ip", ip),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    console.error("[admin] saving the trash retention failed", error.message);
    return { ok: false, error: "failed" };
  }
  revalidatePath(`${ADMIN_PATH}/ai`);
  return { ok: true };
}
