import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { categoryNames } from "@/features/finance/plan/category-names";
import { loadPlanMonth, loadPlanTransactions } from "@/features/finance/plan/load";
import { planWeekOf } from "@/features/finance/plan/weeks";
import { todayIsoDate, type FormatSettings } from "@/lib/format";
import type { Database } from "@/types/database";
import { cashPlanOf, type CashPlan } from "../cash-plan";

/**
 * The plan of the month the user's today belongs to (by the Monday of its
 * week), read with the client given (the user's own: row level security
 * keeps it to a space where they may see finance). Anything that fails, or
 * a month without a plan, is simply no plan: Jarvis then says nothing about it.
 */
export async function loadCashPlan(
  client: SupabaseClient<Database>,
  space: string,
  settings: FormatSettings,
  now: Date = new Date(),
): Promise<CashPlan | null> {
  if (!space) return null;
  const today = todayIsoDate(settings, now);
  const { month } = planWeekOf(today);
  try {
    const plan = await loadPlanMonth(client, space, month);
    if (!plan.month) return null;
    const transactions = await loadPlanTransactions(client, space, month);
    return cashPlanOf({ plan, transactions, today, categoryNames: categoryNames() });
  } catch (error) {
    console.error("jarvis cash plan failed", error);
    return null;
  }
}
