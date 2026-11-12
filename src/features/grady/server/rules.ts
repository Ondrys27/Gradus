import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { DEFAULT_GRADY_RULES, resolveGradyRules, type GradyRules } from "../rules";
import { CAPS_TTL_MS } from "./caps";

type Client = SupabaseClient<Database>;

/**
 * How long a server instance reuses the rules it read: the same 30 seconds
 * as the AI caps. The instance that saved a change forgets its copy at once.
 */
export const RULES_TTL_MS = CAPS_TTL_MS;

let cache: { at: number; rules: GradyRules } | null = null;

/** Forget what this instance read, after the administration saved a change. */
export function clearGradyRulesCache() {
  cache = null;
}

/**
 * The rules in force: the 'jarvis_rules' row, or today's constants when
 * there is none. A failed read keeps Grady on the defaults (logged), never
 * switches him off nor leaves out the safety rules of the prompt. Only the
 * server reads app_settings (admin client).
 */
export async function loadGradyRules(
  admin: Client,
  options: { now?: number; fresh?: boolean } = {},
): Promise<GradyRules> {
  const now = options.now ?? Date.now();
  if (!options.fresh && cache && now - cache.at <= RULES_TTL_MS) return cache.rules;
  try {
    const { data, error } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "jarvis_rules")
      .maybeSingle();
    if (error) {
      console.error("grady rules read failed", error.message);
      return DEFAULT_GRADY_RULES;
    }
    const rules = resolveGradyRules(data?.value ?? null);
    cache = { at: now, rules };
    return rules;
  } catch (failure) {
    console.error("grady rules read failed", failure);
    return DEFAULT_GRADY_RULES;
  }
}
