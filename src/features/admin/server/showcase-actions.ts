"use server";

import { revalidatePath } from "next/cache";
import {
  clearShowcaseSettingCache,
  SHOWCASE_SETTING_KEY,
} from "@/features/tutorial/showcase/server/settings";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_PATH } from "../access";
import { adminAccessFor } from "./guard";
import { fingerprint, requestInfo } from "./request-info";

/**
 * Administration → Settings → Showcase (step 27.4): the switch that makes
 * the showcase exist for the app's owner and administrators (/app/ukazka and
 * the tutorial's third card). Off by default. The owner or a full admin
 * (aal2, live admin session) changes it; the database function checks that
 * again, checks the value (valid_showcase_mode) and audits the change in the
 * same transaction. Other instances see it within 30 seconds.
 */

export type ShowcaseActionResult = { ok: true } | { ok: false; error: "forbidden" | "failed" };

export async function saveShowcaseMode(enabled: boolean): Promise<ShowcaseActionResult> {
  if (typeof enabled !== "boolean") return { ok: false, error: "failed" };
  if (!(await adminAccessFor("editShowcase"))) return { ok: false, error: "forbidden" };
  const { ip } = await requestInfo();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_app_setting", {
    _key: SHOWCASE_SETTING_KEY,
    _value: { enabled },
    _ip_hash: fingerprint("ip", ip),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    console.error("[admin] saving the showcase mode failed", error.message);
    return { ok: false, error: "failed" };
  }
  clearShowcaseSettingCache();
  revalidatePath(`${ADMIN_PATH}/ukazka`);
  return { ok: true };
}
