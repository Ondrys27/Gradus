import type { IsoDate } from "@/lib/format";
import type { PlanTransaction } from "./assign";
import type { LoadedPlan } from "./load";
import { computeSheet, kindsOf, planValues } from "./sheet";
import { monthWeeks, weekInMonth, type PlanMonthKey } from "./weeks";

/** One point of the capital chart: the end of a week. */
export type CapitalPoint = {
  month: PlanMonthKey;
  week: number;
  end: IsoDate;
  /** The planned closing capital of the week. */
  plan: number;
  /** The month's opening plus what really came in and went out, for weeks that have begun. */
  actual: number | null;
  currency: string;
};

/**
 * The capital week by week over the months that have a plan (the chart in
 * Overview: three months back, three ahead). Each month starts from its own
 * opening capital, as in the table; transactions in other currencies are left
 * out, amounts never convert.
 */
export function capitalSeries(plans: LoadedPlan[], transactions: PlanTransaction[], today: IsoDate): CapitalPoint[] {
  const points: CapitalPoint[] = [];
  const sorted = plans
    .filter((plan): plan is LoadedPlan & { month: NonNullable<LoadedPlan["month"]> } => Boolean(plan.month))
    .sort((a, b) => a.month.month.localeCompare(b.month.month));
  for (const plan of sorted) {
    const key = plan.month.month;
    const weeks = monthWeeks(key);
    const sheet = computeSheet({
      weeks: weeks.length,
      opening: plan.month.opening_capital,
      kinds: kindsOf(plan.rows),
      values: planValues(plan.rows, plan.cells, weeks.length),
    });
    const balance = Array<number>(weeks.length).fill(0);
    for (const transaction of transactions) {
      if (transaction.currency !== plan.month.currency) continue;
      const week = weekInMonth(key, transaction.occurred_on);
      if (week === null) continue;
      const signed = transaction.type === "income" ? transaction.amount : -transaction.amount;
      balance[week - 1] = Math.round(balance[week - 1] * 100 + signed * 100) / 100;
    }
    let running = plan.month.opening_capital;
    weeks.forEach((week, index) => {
      running = Math.round(running * 100 + balance[index] * 100) / 100;
      points.push({
        month: key,
        week: week.week,
        end: week.end,
        plan: sheet.closing.weeks[index],
        actual: week.start <= today ? running : null,
        currency: plan.month.currency,
      });
    });
  }
  return points;
}
