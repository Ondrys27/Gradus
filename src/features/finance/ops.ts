import type { OpsEnv } from "@/lib/ops";
import type { RecurringInput, TransactionInput } from "./schemas";

/**
 * The writes of Finance (transactions and recurring payments), shared by
 * the screens (queries.ts) and Grady's tools. `workspaceId` is whose books:
 * the owner's, also for a worker with the finance right. The XP of a new
 * transaction stays with the caller (award_xp finds the unrewarded one).
 */

export async function saveTransaction(
  env: OpsEnv,
  args: { workspaceId: string; id?: string; input: TransactionInput },
): Promise<{ id: string }> {
  const row = { ...args.input, description: args.input.description || null };
  const { data, error } = args.id
    ? await env.db
        .from("transactions")
        .update(row)
        .eq("user_id", args.workspaceId)
        .eq("id", args.id)
        .select("id")
        .single()
    : await env.db
        .from("transactions")
        .insert({ ...row, user_id: args.workspaceId })
        .select("id")
        .single();
  if (error) throw error;
  if (args.id) {
    env.track("transaction_updated", { type: args.input.type });
  } else {
    env.track("transaction_created", {
      type: args.input.type,
      currency: args.input.currency,
      has_category: args.input.category !== null,
    });
  }
  return data;
}

export async function deleteTransaction(env: OpsEnv, id: string): Promise<void> {
  const { error } = await env.db.from("transactions").delete().eq("id", id);
  if (error) throw error;
  env.track("transaction_deleted", {});
}

/** Weekly payments have no day of the month; the others keep the day of the first one. */
export function recurringDueDay(input: Pick<RecurringInput, "frequency" | "next_due_on">) {
  return input.frequency === "weekly" ? null : Number(input.next_due_on.slice(8, 10));
}

export async function saveRecurring(
  env: OpsEnv,
  args: { workspaceId: string; id?: string; input: RecurringInput },
): Promise<{ id: string }> {
  const row = { ...args.input, due_day: recurringDueDay(args.input) };
  const { data, error } = args.id
    ? await env.db
        .from("recurring_payments")
        .update(row)
        .eq("user_id", args.workspaceId)
        .eq("id", args.id)
        .select("id")
        .single()
    : await env.db
        .from("recurring_payments")
        .insert({ ...row, user_id: args.workspaceId })
        .select("id")
        .single();
  if (error) throw error;
  env.track("recurring_payment_saved", {
    created: !args.id,
    type: args.input.type,
    frequency: args.input.frequency,
  });
  return data;
}

export async function deleteRecurring(env: OpsEnv, id: string): Promise<void> {
  const { error } = await env.db.from("recurring_payments").delete().eq("id", id);
  if (error) throw error;
  env.track("recurring_payment_deleted", {});
}
