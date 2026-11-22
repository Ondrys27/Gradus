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
    const people = await client.rpc("company_tree");
    if (people.error) throw people.error;
    const ownWorkerId =
      space === accountId ? null : (people.data.find((person) => person.user_id === accountId)?.id ?? null);
    return rewardsSituation({
      totals: totalsFromRows(totals.data),
      ownWorkerId,
      names: new Map(people.data.map((person) => [person.id, person.name])),
    });
  } catch (error) {
    console.error("grady rewards failed", error);
    return null;
  }
}
