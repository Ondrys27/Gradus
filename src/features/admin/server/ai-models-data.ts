import "server-only";
import { budgetStatus, utcMonthStart } from "@/features/grady/budget";
import { summarizeModelUsage, type ModelUsageRow, type ModelUsageSummary } from "@/features/grady/model-usage";
import type { GradyModelSettings } from "@/features/grady/model-settings";
import { loadAiCaps } from "@/features/grady/server/caps";
import { loadGradyModels } from "@/features/grady/server/model-settings";
import {
  recommendModels,
  type ModelRecommendation,
  type QualitySignals,
} from "@/features/grady/savings";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** Calls and tokens by job and model with the batch flag; before the 28.9 migration without it. */
async function loadUsageRows(admin: Admin, since: Date) {
  const tiered = await admin.rpc("admin_ai_model_usage_by_tier", { _since: since.toISOString() });
  if (!tiered.error) return tiered.data ?? [];
  const plain = await admin.rpc("admin_ai_model_usage", { _since: since.toISOString() });
  if (plain.error) throw plain.error;
  return (plain.data ?? []).map((row) => ({ ...row, batch: false }));
}

/** Re-asks, failures, ratings and undone changes by job; null when the function is not there yet. */
async function loadQualitySignals(admin: Admin, since: Date): Promise<QualitySignals | null> {
  const { data, error } = await admin.rpc("admin_ai_quality_signals", {
    _since: since.toISOString(),
  });
  if (error) {
    console.error("[admin] AI quality signals failed", error.message);
    return null;
  }
  return Object.fromEntries(
    (data ?? []).map((row) => [
      row.purpose,
      {
        calls: Number(row.calls ?? 0),
        asks: Number(row.asks ?? 0),
        repeats: Number(row.repeats ?? 0),
        failures: Number(row.failures ?? 0),
        ratingsUp: Number(row.ratings_up ?? 0),
        ratingsDown: Number(row.ratings_down ?? 0),
        actions: Number(row.actions ?? 0),
        actionsUndone: Number(row.actions_undone ?? 0),
      },
    ]),
  );
}

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
  /** Signs of the answers' quality by job (re-asks, failures, ratings); null before the 28.9 migration. */
  signals: QualitySignals | null;
  /** "Where to save" (step 28.9): cheaper where quality holds, better where it does not. */
  recommendations: ModelRecommendation[];
  /** The month's spend is past the warning threshold: every job runs on its minimum. */
  economyByBudget: boolean;
  /** The threshold as a share of the monthly cap (ai_caps.warn_percent). */
  warnShare: number;
};

export async function loadModelsOverview(now: Date = new Date()): Promise<ModelsOverview> {
  const admin = createAdminClient();
  const since = new Date(now.getTime() - MODEL_USAGE_DAYS * 86_400_000);
  const [settings, usage, caps, month, signals] = await Promise.all([
    loadGradyModels(admin, { fresh: true }),
    loadUsageRows(admin, since),
    loadAiCaps(admin, { fresh: true }),
    admin.rpc("jarvis_month_spend", { _since: utcMonthStart(now).toISOString() }),
    loadQualitySignals(admin, since),
  ]);
  if (month.error) throw month.error;
  const rows: ModelUsageRow[] = usage.map((row) => ({
    purpose: row.purpose,
    model: row.model,
    routedFrom: row.routed_from ?? null,
    longPrompt: !!row.long_prompt,
    batch: !!row.batch,
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
  const summary = summarizeModelUsage(rows);
  return {
    settings,
    usage: summary,
    signals,
    recommendations: signals ? recommendModels(summary, signals, settings) : [],
    economyByBudget: budgetStatus(spent, caps.monthlyUsd, caps.warnShare) === "near",
    warnShare: caps.warnShare,
  };
}
