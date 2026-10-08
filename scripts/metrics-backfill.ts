/**
 * Fills metrics_daily for every finished day the data reaches back to: from
 * the first account (or the oldest analytics event, whichever is older, at
 * most 13 months back) to yesterday. The nightly job keeps it current after.
 *
 *   bun run metrics:backfill            all history
 *   bun run metrics:backfill 2026-09-01 from a given day
 *
 * Safe to run again: each day is recomputed and overwritten, nothing else is
 * touched. Needs NEXT_PUBLIC_SUPABASE_URL and the secret (service role) key in
 * the environment; Bun reads .env and .env.local by itself.
 */
import { createClient } from "@supabase/supabase-js";
import { daysBetween, metricsToday, shiftDay } from "../src/lib/analytics/metrics";
import type { Database } from "../src/types/database";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secretKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or the secret key.");
  process.exit(2);
}

const admin = createClient<Database>(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/** The oldest created_at of a table, as a date in the metrics zone. */
async function oldest(table: "profiles" | "analytics_events"): Promise<string | null> {
  const { data, error } = await admin
    .from(table)
    .select("created_at")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  const first = data?.[0]?.created_at;
  return first ? metricsToday(new Date(first)) : null;
}

async function main() {
  const yesterday = shiftDay(metricsToday(), -1);
  const limit = shiftDay(metricsToday(), -396);
  const given = process.argv[2];
  if (given && !/^\d{4}-\d{2}-\d{2}$/.test(given)) {
    console.error("The start day must look like 2026-09-01.");
    process.exit(2);
  }
  const candidates = given
    ? [given]
    : [await oldest("profiles"), await oldest("analytics_events")].filter(
        (day): day is string => day !== null,
      );
  if (candidates.length === 0) {
    console.log("No data yet, nothing to backfill.");
    return;
  }
  const earliest = [...candidates].sort()[0];
  const from = earliest < limit ? limit : earliest;
  if (from > yesterday) {
    console.log("Only today has data; it is always computed live.");
    return;
  }

  const days = daysBetween(from, yesterday);
  console.log(`Backfilling ${days.length} days, ${from} – ${yesterday}…`);
  let rows = 0;
  for (const day of days) {
    const { data, error } = await admin.rpc("refresh_metrics_daily", { _day: day });
    if (error) throw new Error(`${day}: ${error.message}`);
    rows += data ?? 0;
    process.stdout.write(".");
  }
  console.log(`\nDone: ${rows} values in metrics_daily.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
