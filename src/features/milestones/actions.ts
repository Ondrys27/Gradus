"use server";

import { measure } from "@/lib/analytics/instrument";
import { trackLater } from "@/lib/analytics/track";
import { createClient } from "@/lib/supabase/server";
import { moveTask } from "./ops";
import { moveTaskSchema, type MoveTaskResult } from "./schemas";

/**
 * Moves a milestone task (with everything below it) under a new parent, or to
 * level 1, at a place among its new siblings. One call of move_task() with the
 * user's own client: one transaction, RLS and the read-only rule as for any
 * write, cycle and depth checked by the database. Failures come back as codes.
 */
const move = measure("milestones.moveTask", async (input: unknown): Promise<MoveTaskResult> => {
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { ok: false, error: "forbidden" };

  return moveTask(
    { db: supabase, track: (event, props) => trackLater(event, props, { userId }) },
    parsed.data,
  );
});

export async function moveTaskAction(input: unknown): Promise<MoveTaskResult> {
  return move(input);
}
