"use server";

import { revalidatePath } from "next/cache";
import { gradyRulesFormSchema, toStoredGradyRules, type GradyRulesForm } from "@/features/grady/rules";
import { clearGradyRulesCache } from "@/features/grady/server/rules";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_PATH } from "../access";
import { adminAccessFor } from "./guard";
import { fingerprint, requestInfo } from "./request-info";

/**
 * Grady's rules changed from the administration (AI and Grady → Rules).
 * The owner's admin session (role owner, aal2) is checked first; an admin
 * only reads the rules. The database function checks it once more from the
 * signed token, validates the value (valid_jarvis_rules), saves it and
 * writes who changed what from what to what into admin_audit, all in one
 * transaction. Other server instances pick the change up within 30 seconds.
 */

export type RulesActionResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "forbidden" | "failed"; fields?: string[] };

export async function saveGradyRules(input: GradyRulesForm): Promise<RulesActionResult> {
  const parsed = gradyRulesFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")))],
    };
  }
  if (!(await adminAccessFor("editGradyRules"))) return { ok: false, error: "forbidden" };

  const { ip } = await requestInfo();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_app_setting", {
    _key: "jarvis_rules",
    _value: toStoredGradyRules(parsed.data),
    _ip_hash: fingerprint("ip", ip),
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    if (error.code === "22023") return { ok: false, error: "invalid" };
    console.error("[admin] saving Grady rules failed", error.message);
    return { ok: false, error: "failed" };
  }
  clearGradyRulesCache();
  revalidatePath(`${ADMIN_PATH}/ai`);
  return { ok: true };
}
