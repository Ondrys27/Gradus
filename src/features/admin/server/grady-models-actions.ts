"use server";

import { revalidatePath } from "next/cache";
import {
  gradyModelsFormSchema,
  toStoredGradyModels,
  type GradyModelsForm,
} from "@/features/grady/model-settings";
import { clearGradyModelsCache } from "@/features/grady/server/model-settings";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_PATH } from "../access";
import { adminAccessFor } from "./guard";
import { fingerprint, requestInfo } from "./request-info";

/**
 * The model of each of Grady's jobs changed from the administration (AI and
 * Grady → Models, step 27.3). The admin session (the owner or a full admin,
 * aal2) is checked first; a limited admin only reads the settings. The
 * database function checks it once more from the signed token, checks the
 * value's shape (valid_grady_models), saves it and writes who changed what
 * from what to what into admin_audit, all in one transaction. Other server
 * instances pick the change up within 30 seconds.
 */

export type ModelsActionResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "forbidden" | "failed" };

export async function saveGradyModels(input: GradyModelsForm): Promise<ModelsActionResult> {
  const parsed = gradyModelsFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!(await adminAccessFor("editGradyModels"))) return { ok: false, error: "forbidden" };

  const { ip } = await requestInfo();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_app_setting", {
    _key: "grady_models",
    _value: toStoredGradyModels(parsed.data as GradyModelsForm),
    _ip_hash: fingerprint("ip", ip),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    if (error.code === "22023") return { ok: false, error: "invalid" };
    console.error("[admin] saving Grady's models failed", error.message);
    return { ok: false, error: "failed" };
  }
  clearGradyModelsCache();
  revalidatePath(`${ADMIN_PATH}/ai`);
  return { ok: true };
}
