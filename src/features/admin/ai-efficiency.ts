/**
 * What Grady costs per person (AI and Grady → overview, step 28.9). Pure:
 * the rows are admin_ai_efficiency() (one per day in the metrics' zone and
 * one without a day for the whole period). Cost per active user a day is the
 * average over the days with active users; a month is the period's cost per
 * distinct active user scaled to 30 days. The cache share is the prompt
 * read from the cache; an average chat answer is the chat's cost (with the
 * routing calls) per answer. The trend compares the second half of the
 * period with the first.
 */
import type { IsoDate } from "@/lib/format";

export type EfficiencyRow = {
  day: IsoDate | null;
  activeUsers: number;
  aiUsers: number;
  costUsd: number;
  calls: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  chatCostUsd: number;
  chatAnswers: number;
  batchCostUsd: number;
};

export type EfficiencyDay = {
  day: IsoDate;
  perActiveUserUsd: number | null;
  chatAnswerUsd: number | null;
  cacheShare: number | null;
};

export type Efficiency = {
  days: number;
  costUsd: number;
  activeUsers: number;
  aiUsers: number;
  perActiveUserDayUsd: number | null;
  perActiveUserMonthUsd: number | null;
  cacheShare: number | null;
  chatAnswerUsd: number | null;
  /** Share of the cost paid at the batch price (the briefs and the watch). */
  batchShare: number | null;
  /** Second half against the first: +0.1 = 10 % more per active user a day. */
  trend: { perActiveUser: number | null; chatAnswer: number | null };
  series: EfficiencyDay[];
};

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

function cacheShareOf(row: Pick<EfficiencyRow, "inputTokens" | "cacheReadTokens" | "cacheWriteTokens">) {
  return ratio(row.cacheReadTokens, row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens);
}

function mean(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

function change(before: number | null, after: number | null): number | null {
  if (before === null || after === null || before <= 0) return null;
  return after / before - 1;
}

export function summarizeEfficiency(rows: readonly EfficiencyRow[]): Efficiency {
  const perDay = rows.filter((row): row is EfficiencyRow & { day: IsoDate } => row.day !== null);
  const total = rows.find((row) => row.day === null) ?? null;
  const series: EfficiencyDay[] = perDay.map((row) => ({
    day: row.day,
    perActiveUserUsd: ratio(row.costUsd, row.activeUsers),
    chatAnswerUsd: ratio(row.chatCostUsd, row.chatAnswers),
    cacheShare: cacheShareOf(row),
  }));
  const days = perDay.length;
  const costUsd = total?.costUsd ?? perDay.reduce((sum, row) => sum + row.costUsd, 0);
  const activeUsers = total?.activeUsers ?? 0;
  const half = Math.floor(days / 2);
  const first = series.slice(0, half);
  const second = series.slice(days - half);
  const sum = (pick: (row: EfficiencyRow) => number) =>
    total ? pick(total) : perDay.reduce((acc, row) => acc + pick(row), 0);
  return {
    days,
    costUsd,
    activeUsers,
    aiUsers: total?.aiUsers ?? 0,
    perActiveUserDayUsd: mean(series.map((row) => row.perActiveUserUsd)),
    perActiveUserMonthUsd:
      activeUsers > 0 && days > 0 ? (costUsd / activeUsers) * (30 / days) : null,
    cacheShare: total ? cacheShareOf(total) : null,
    chatAnswerUsd: ratio(
      sum((row) => row.chatCostUsd),
      sum((row) => row.chatAnswers),
    ),
    batchShare: ratio(
      sum((row) => row.batchCostUsd),
      costUsd,
    ),
    trend: {
      perActiveUser: half
        ? change(
            mean(first.map((row) => row.perActiveUserUsd)),
            mean(second.map((row) => row.perActiveUserUsd)),
          )
        : null,
      chatAnswer: half
        ? change(
            mean(first.map((row) => row.chatAnswerUsd)),
            mean(second.map((row) => row.chatAnswerUsd)),
          )
        : null,
    },
    series,
  };
}
