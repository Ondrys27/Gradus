import "server-only";
import { METRICS_TIMEZONE } from "@/lib/analytics/metrics";
import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeEfficiency, type Efficiency } from "../ai-efficiency";
import type { ChartData } from "../types";
import type { AdminQuery } from "./metrics-data";

/**
 * What Grady costs per person over the range of the top bar (step 28.9):
 * admin_ai_efficiency() by day in the metrics' zone, internal accounts left
 * out unless the view includes them. Read only after the admin gate.
 */
export async function loadAiEfficiency(q: AdminQuery): Promise<Efficiency> {
  const { data, error } = await createAdminClient().rpc("admin_ai_efficiency", {
    _from: q.range.from,
    _to: q.range.to,
    _tz: METRICS_TIMEZONE,
    _include_internal: q.view.internal,
  });
  if (error) throw error;
  return summarizeEfficiency(
    (data ?? []).map((row) => ({
      day: row.day ?? null,
      activeUsers: Number(row.active_users ?? 0),
      aiUsers: Number(row.ai_users ?? 0),
      costUsd: Number(row.cost_usd ?? 0),
      calls: Number(row.calls ?? 0),
      inputTokens: Number(row.input_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_tokens ?? 0),
      cacheWriteTokens: Number(row.cache_write_tokens ?? 0),
      chatCostUsd: Number(row.chat_cost_usd ?? 0),
      chatAnswers: Number(row.chat_answers ?? 0),
      batchCostUsd: Number(row.batch_cost_usd ?? 0),
    })),
  );
}

/** The trend: cost per active user a day and of 1,000 chat answers, by day. */
export function efficiencyChart(efficiency: Efficiency): ChartData {
  return {
    id: "ai.efficiency",
    xKind: "day",
    unit: "usd",
    rightUnit: "usd",
    series: [
      {
        key: "per_user",
        kind: "line",
        color: "violet",
        label: { key: "ai.efficiency.chart.perUser" },
      },
      {
        key: "per_thousand_answers",
        kind: "line",
        color: "teal",
        axis: "right",
        label: { key: "ai.efficiency.chart.perThousandAnswers" },
      },
    ],
    rows: efficiency.series.map((day) => ({
      x: day.day,
      per_user: day.perActiveUserUsd,
      per_thousand_answers: day.chatAnswerUsd === null ? null : day.chatAnswerUsd * 1000,
    })),
  };
}
