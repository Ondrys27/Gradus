import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogPlan } from "@/config/pricing";
import { catalogWorkerTerms, workerSeats } from "@/features/plan/worker-seats";
import type { Database } from "@/types/database";

type Admin = SupabaseClient<Database>;

/**
 * How many extra workers the owner pays for on `plan` (22.5): everybody not
 * ended without a valid plan of their own, beyond the seats in the price.
 * Zero when the plan takes no extra workers (they are over its terms, not
 * charged). worker_seats() answers per worker, oldest first.
 */
export async function extraWorkerQuantity(admin: Admin, workspace: string, plan: CatalogPlan): Promise<number> {
  const terms = catalogWorkerTerms(plan);
  if (!terms.perWorker) return 0;
  const { data, error } = await admin.rpc("worker_seats", { _owner: workspace });
  if (error) throw new Error(`worker_seats: ${error.code ?? error.message}`);
  const seats = workerSeats(
    terms,
    (data ?? []).map((row) => ({ id: row.worker_id, ownPlan: row.own_plan })),
  );
  return seats.extra;
}
