import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rewardsSituation, type RewardsSituation } from "@/features/workers/rewards/situation";
import { monthBounds, totalsFromRows } from "@/features/workers/rewards/summary";
import type { FormatSettings } from "@/lib/format";
import type { Database } from "@/types/database";

/**
 * Worker rewards for Grady (28.2), read with the user's own client: row level
 * security keeps it to the user's own rewards and to the people whose rewards
 * they manage (a manager without "company: rewards" gets nothing of the
 * people under them). Names from company_tree(), the same people Company
 * shows. Anything that fails is simply no rewards: Grady then says nothing.
 */
export async function loadRewardsSituation(
  client: SupabaseClient<Database>,
  space: string,
  accountId: string | null,
  settings: FormatSettings,
  now: Date = new Date(),
): Promise<RewardsSituation | null> {
  if (!space || !accountId) return null;
  try {
    const { from, until } = monthBounds(settings, now);
    const totals = await client.rpc("reward_totals", { _from: from, _until: until });
    if (totals.error) throw totals.error;
    // Most accounts have no rewards at all: the names are read only when there are some.
    if (totals.data.length === 0) return null;
    const [people, own] = await Promise.all([
      client.rpc("company_tree"),
      space === accountId
        ? Promise.resolve({ data: null, error: null })
        : client
            .from("workers")
            .select("id")
            .eq("owner_id", space)
            .eq("user_id", accountId)
            .maybeSingle(),
    ]);
    if (people.error) throw people.error;
    if (own.error) throw own.error;
    const ownWorkerId =
      space === accountId
        ? null
        : (own.data?.id ?? people.data.find((person) => person.user_id === accountId)?.id ?? null);
    // reward_totals() sums whatever RLS lets the account read, in every company
    // it belongs to; only the people of this space go into this space's context.
    const inSpace = new Set(people.data.map((person) => person.id));
    if (ownWorkerId) inSpace.add(ownWorkerId);
    return rewardsSituation({
      totals: totalsFromRows(totals.data.filter((row) => inSpace.has(row.worker_id))),
      ownWorkerId,
      names: new Map(people.data.map((person) => [person.id, person.name])),
    });
  } catch (error) {
    console.error("grady rewards failed", error);
    return null;
  }
}
