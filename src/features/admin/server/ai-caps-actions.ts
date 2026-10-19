"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  aiCapsFormSchema,
  toStoredAiCaps,
  userCapFormSchema,
  type AiCapsForm,
  type UserCapForm,
} from "@/features/jarvis/caps";
import { clearAiCapsCache } from "@/features/jarvis/server/caps";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_PATH } from "../access";
import { adminAccessFor } from "./guard";
import { fingerprint, requestInfo } from "./request-info";

/**
 * The AI caps changed from the administration. Each action checks the owner's
 * admin session (role owner, aal2) first; an admin only reads the caps; the database function then checks
 * it once more from the signed token, saves the value and writes who changed
 * what from what to what into admin_audit, all in one transaction.
 */

export type CapsActionResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "forbidden" | "failed"; fields?: string[] };

function invalid(error: z.ZodError): CapsActionResult {
  return {
    ok: false,
    error: "invalid",
    fields: [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "")))],
  };
}

async function ipHash(): Promise<string | undefined> {
  const { ip } = await requestInfo();
  return fingerprint("ip", ip);
}

/** The database refused: the session (42501) or the value (22023). */
function refused(error: { code?: string; message: string }): CapsActionResult {
  if (error.code === "42501") return { ok: false, error: "forbidden" };
  if (error.code === "22023") return { ok: false, error: "invalid" };
  console.error("[admin] saving AI caps failed", error.message);
  return { ok: false, error: "failed" };
}

export async function saveAiCaps(input: AiCapsForm): Promise<CapsActionResult> {
  const parsed = aiCapsFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  if (!(await adminAccessFor("editAiCaps"))) return { ok: false, error: "forbidden" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_app_setting", {
    _key: "ai_caps",
    _value: toStoredAiCaps(parsed.data),
    _ip_hash: await ipHash(),
  });
  if (error) return refused(error);
  clearAiCapsCache();
  revalidatePath(`${ADMIN_PATH}/ai`);
  return { ok: true };
}

const userIdSchema = z.uuid();

export async function saveUserAiCap(userId: string, input: UserCapForm): Promise<CapsActionResult> {
  const id = userIdSchema.safeParse(userId);
  if (!id.success) return { ok: false, error: "invalid" };
  const parsed = userCapFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  if (!(await adminAccessFor("editAiCaps"))) return { ok: false, error: "forbidden" };

  const cap = parsed.data.mode === "cap" ? parsed.data.capUsd : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_ai_user_cap", {
    _user_id: id.data,
    // The generated types miss that the argument may be null (no own cap).
    _cap_usd: cap as number,
    _blocked: parsed.data.mode === "blocked",
    _ip_hash: await ipHash(),
  });
  if (error) return refused(error);
  clearAiCapsCache();
  revalidatePath(`${ADMIN_PATH}/uzivatele/${id.data}`);
  return { ok: true };
}
