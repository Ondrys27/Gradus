import "server-only";
import { parseAdminView } from "@/features/admin/view-state";
import { metricsToday, shiftDay } from "@/lib/analytics/metrics";
import type { IsoDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  eventTotalOver,
  loadAdminWidget,
  moneyQuery,
  within,
} from "../../dashboard/server/widget-data";
import { loadPeriodSpend } from "../../server/ai-caps-data";
import type { AdminContext } from "../../server/guard";
import { seriesTile, type AdminQuery } from "../../server/metrics-data";
import { paymentsByCurrency } from "../../server/page-data";
import type { DayTrend, DigestFacts } from "../facts";

/**
 * The numbers of one day for the summary, read the way the administration
 * reads them (the metric registry, the widgets' loaders, the AI spend, the
 * error log): with the default view, internal accounts left out, money in
 * Stripe's test mode from the test accounts (and labelled so). The loaders
 * that depend on powers run as the owner; composeDigest() then leaves out
 * what a limited admin may not see.
 */

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** The digest's view of the administration: a query for one day. */
export function dayQuery(day: IsoDate): AdminQuery {
  return { view: parseAdminView({}), range: { from: day, to: day }, previous: null, today: metricsToday() };
}

async function trend(q: AdminQuery, key: string, how: "sum" | "mean"): Promise<DayTrend> {
  const day = q.range.from as IsoDate;
  const at = (d: IsoDate) => seriesTile(within(q, { from: d, to: d }), key, how).then((tile) => num(tile.value));
  const [value, dayBefore, weekAgo] = await Promise.all([at(day), at(shiftDay(day, -1)), at(shiftDay(day, -7))]);
  return { value, dayBefore, weekAgo };
}

type FactsRpc = {
  new_errors?: number;
  error_occurrences?: number;
  top_errors?: { code: string; message: string; occurrences: number }[];
  resolved_errors?: number;
  reports?: number;
  ideas?: number;
  survey?: number;
};

export async function loadDigestFacts(day: IsoDate, owner: AdminContext): Promise<DigestFacts> {
  const q = dayQuery(day);
  const before = shiftDay(day, -1);
  const { q: money, testData } = moneyQuery(q);
  const one = (d: IsoDate) => ({ from: d, to: d });
  const [newUsers, activeUsers, revenue, revenueBefore, started, cancelled, spend, spendBefore, rpc, waiting, health] =
    await Promise.all([
      trend(q, "signups", "sum"),
      trend(q, "dau", "mean"),
      paymentsByCurrency(within(money, one(day))),
      paymentsByCurrency(within(money, one(before))),
      eventTotalOver(money, "checkout_completed", "count", one(day)),
      eventTotalOver(money, "subscription_cancelled", "count", one(day)),
      loadPeriodSpend(day, day),
      loadPeriodSpend(before, before),
      createAdminClient().rpc("admin_digest_facts", { _day: day }),
      loadAdminWidget("waiting", q, owner),
      loadAdminWidget("health", q, owner),
    ]);
  if (rpc.error) throw new Error(`admin_digest_facts: ${rpc.error.message}`);
  const f = (rpc.data ?? {}) as FactsRpc;

  const currencies = new Set([...revenue, ...revenueBefore].map((row) => row.currency));
  const revenueOf = (rows: typeof revenue, currency: string) =>
    num(rows.find((row) => row.currency === currency)?.revenue);
  const perActive = (usd: number, active: number) => (active > 0 ? usd / active : null);
  const waitingOf = (id: string) => num(waiting?.rows?.find((row) => row.id === id)?.value);

  return {
    day,
    newUsers,
    activeUsers,
    money: {
      testMode: testData,
      revenue: [...currencies]
        .map((currency) => ({
          currency,
          value: revenueOf(revenue, currency),
          dayBefore: revenueOf(revenueBefore, currency),
        }))
        .filter((row) => row.value > 0 || row.dayBefore > 0),
      started,
      cancelled,
    },
    ai: {
      spentUsd: spend.spentUsd,
      dayBeforeUsd: spendBefore.spentUsd,
      perActiveUsd: perActive(spend.spentUsd, activeUsers.value),
      perActiveDayBeforeUsd: perActive(spendBefore.spentUsd, activeUsers.dayBefore),
    },
    errors: {
      newGroups: num(f.new_errors),
      occurrences: num(f.error_occurrences),
      top: Array.isArray(f.top_errors)
        ? f.top_errors.slice(0, 3).map((row) => ({
            code: String(row.code),
            message: String(row.message ?? ""),
            occurrences: num(row.occurrences),
          }))
        : [],
      resolved: num(f.resolved_errors),
    },
    feedback: { reports: num(f.reports), ideas: num(f.ideas), survey: num(f.survey) },
    waiting: {
      errors: waitingOf("errors"),
      reports: waitingOf("reports"),
      payouts: waitingOf("payouts"),
      draft: waitingOf("draft"),
    },
    health: (health?.rows ?? [])
      .filter((row) => row.status === "warn" || row.status === "bad")
      .map((row) => ({ key: row.id, status: row.status as "warn" | "bad" })),
  };
}
