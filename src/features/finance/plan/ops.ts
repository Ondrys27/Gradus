import type { OpsEnv } from "@/lib/ops";

/**
 * One planned number of the month plan, shared by the sheet (queries.ts) and
 * Grady's tools: an empty or zero cell has no row, any other is upserted.
 */
export async function savePlanCell(
  env: Pick<OpsEnv, "db">,
  args: { space: string; rowId: string; week: number; value: number | null },
): Promise<void> {
  const { error } =
    args.value === null || args.value === 0
      ? await env.db
          .from("finance_plan_cells")
          .delete()
          .eq("user_id", args.space)
          .eq("row_id", args.rowId)
          .eq("week", args.week)
      : await env.db
          .from("finance_plan_cells")
          .upsert(
            { user_id: args.space, row_id: args.rowId, week: args.week, planned: args.value },
            { onConflict: "row_id,week" },
          );
  if (error) throw error;
}
