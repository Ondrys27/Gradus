import "server-only";
import { budgetStatus, utcMonthStart } from "@/features/grady/budget";
import { summarizeModelUsage, type ModelUsageRow, type ModelUsageSummary } from "@/features/grady/model-usage";
import type { GradyModelSettings } from "@/features/grady/model-settings";
import { loadAiCaps } from "@/features/grady/server/caps";
import { loadGradyModels } from "@/features/grady/server/model-settings";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What AI and Grady → Models shows (step 27.3): the settings in force (read
 * fresh, not from the instance's cache), what each job cost over the last 30
 * days with the estimates on every model, and whether economy mode is on
 * for everyone because the month's spend passed the warning threshold. Read
 * only after the guard let an administrator in.
 */

/** The table's window: the last 30 days, whatever the range of the top bar. */
export const MODEL_USAGE_DAYS = 30;

export type ModelsOverview = {
  settings: GradyModelSettings;
  usage: ModelUsageSummary;
  /** The month's spend is past the warning threshold: every job runs on its minimum. */
  economyByBudget: boolean;
  /** The threshold as a share of the monthly cap (ai_caps.warn_percent). */
  warnShare: number;
};

export async function loadModelsOverview(now: Date = new Date()): Promise<ModelsOverview> {
  const admin = createAdminClient();
  const since = new Date(now.getTime() - MODEL_USAGE_DAYS * 86_400_000);
  const [settings, usage, caps, month] = await Promise.all([
    loadGradyModels(admin, { fresh: true }),
    admin.rpc("admin_ai_model_usage", { _since: since.toISOString() }),
    loadAiCaps(admin, { fresh: true }),
    admin.rpc("jarvis_month_spend", { _since: utcMonthStart(now).toISOString() }),
  ]);
  if (usage.error) throw usage.error;
  if (month.error) throw month.error;
  const rows: ModelUsageRow[] = (usage.data ?? []).map((row) => ({
    purpose: row.purpose,
    model: row.model,
    routedFrom: row.routed_from ?? null,
    longPrompt: !!row.long_prompt,
    calls: Number(row.calls ?? 0),
    tokens: {
      inputTokens: Number(row.input_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_tokens ?? 0),
      cacheWriteTokens: Number(row.cache_write_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
    },
    costUsd: Number(row.cost_usd ?? 0),
  }));
  const spent = Number(month.data?.[0]?.cost_usd ?? 0);
  return {
    settings,
    usage: summarizeModelUsage(rows),
    economyByBudget: budgetStatus(spent, caps.monthlyUsd, caps.warnShare) === "near",
    warnShare: caps.warnShare,
  };
}
