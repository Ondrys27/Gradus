import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  DEFAULT_GRADY_MODELS,
  resolveGradyModels,
  type GradyModelSettings,
} from "../model-settings";
import { CAPS_TTL_MS } from "./caps";

type Client = SupabaseClient<Database>;

/**
 * How long a server instance reuses the model settings it read: the same 30
 * seconds as the AI caps and the rules, so a change in the administration
 * applies within a minute. The instance that saved a change forgets its copy
 * at once.
 */
export const MODEL_SETTINGS_TTL_MS = CAPS_TTL_MS;

let cache: { at: number; settings: GradyModelSettings } | null = null;
/** What was already reported to the error log by this instance: one record per problem. */
const reported = new Set<string>();

/** Forget what this instance read, after the administration saved a change. */
export function clearGradyModelsCache() {
  cache = null;
  reported.clear();
}

/** Writes one problem of the stored settings to the error log (Administration → Errors). */
export type ProblemReporter = (problem: string) => void;

async function defaultReporter(problem: string) {
  const { captureServerError } = await import("@/features/errors/alerts/server/capture");
  captureServerError(new Error(`grady_models: ${problem}`), {
    source: "route",
    page: "/api/grady",
    action: "grady_models",
  });
}

/**
 * The model settings in force: the 'grady_models' row, or the defaults
 * (today's assignment, the chat on auto). An unknown or unavailable model
 * falls back to the job's default and goes to the error log once; a failed
 * read keeps the defaults (logged), it never switches Grady off. Only the
 * server reads app_settings (admin client).
 */
export async function loadGradyModels(
  admin: Client,
  options: { now?: number; fresh?: boolean; report?: ProblemReporter } = {},
): Promise<GradyModelSettings> {
  const now = options.now ?? Date.now();
  if (!options.fresh && cache && now - cache.at <= MODEL_SETTINGS_TTL_MS) return cache.settings;
  try {
    const { data, error } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "grady_models")
      .maybeSingle();
    if (error) {
      console.error("grady models read failed", error.message);
      return DEFAULT_GRADY_MODELS;
    }
    const { settings, problems } = resolveGradyModels(data?.value ?? null);
    for (const problem of problems) {
      if (reported.has(problem)) continue;
      reported.add(problem);
      console.error(`grady models: ${problem}, the default applies`);
      const report =
        options.report ??
        ((value: string) =>
          void defaultReporter(value).catch((failure) =>
            console.error("grady models report failed", failure),
          ));
      try {
        report(problem);
      } catch (failure) {
        console.error("grady models report failed", failure);
      }
    }
    cache = { at: now, settings };
    return settings;
  } catch (failure) {
    console.error("grady models read failed", failure);
    return DEFAULT_GRADY_MODELS;
  }
}
