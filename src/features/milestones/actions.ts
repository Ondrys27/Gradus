"use server";

import { measure } from "@/lib/analytics/instrument";
import { trackLater } from "@/lib/analytics/track";
import { createClient } from "@/lib/supabase/server";
import { moveTaskFailure, moveTaskSchema, type MoveTaskResult } from "./schemas";

/**
 * Moves a milestone task (with everything below it) under a new parent, or to
 * level 1, at a place among its new siblings. One call of move_task() with the
 * user's own client: one transaction, RLS and the read-only rule as for any
 * write, cycle and depth checked by the database. Failures come back as codes.
 */
const move = measure("milestones.moveTask", async (input: unknown): Promise<MoveTaskResult> => {
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { taskId, parentId, position, via, depth, levelChanged } = parsed.data;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return { ok: false, error: "forbidden" };

  const { error } = await supabase.rpc("move_task", {
    _task_id: taskId,
    // The generated type does not know that null (level 1) is allowed.
    _parent_id: parentId as string,
    _position: position,
  });
  if (error) {
    const failure = moveTaskFailure(error);
    if (failure === "unknown") console.error("move_task failed", error.code);
    return { ok: false, error: failure };
  }
  trackLater("task_moved", { via, depth, level_changed: levelChanged });
  return { ok: true };
});

export async function moveTaskAction(input: unknown): Promise<MoveTaskResult> {
  return move(input);
}
