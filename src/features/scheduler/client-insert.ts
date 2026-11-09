import type { Database } from "@/types/database";

type Tables = Database["public"]["Tables"];

/**
 * Who a scheduler row belongs to is never the client's to say: on insert the
 * guards set the person from the session (`scheduler_profiles_guard`) and,
 * under a profile, person and space from the profile (`event_types_guard`,
 * `availability_guard`). These columns are left out of the client's column
 * grants, so a request that names them fails with "permission denied" even
 * with the right values. The generated Insert types still require them (not
 * null, no default), hence this one typed way in: the columns are dropped at
 * runtime too, so a spread can never smuggle them back.
 */
export const GUARD_SET_COLUMNS = {
  scheduler_profiles: ["user_id"],
  event_types: ["user_id", "space_id"],
  availability_rules: ["user_id", "space_id"],
  availability_overrides: ["user_id", "space_id"],
} as const;

type Guarded = typeof GUARD_SET_COLUMNS;
export type GuardedTable = keyof Guarded;
export type ClientInsert<T extends GuardedTable> = Omit<
  Tables[T]["Insert"],
  Guarded[T][number]
>;

/** A row as the client may send it to `table` (the guards fill in the rest). */
export function clientInsert<T extends GuardedTable>(
  table: T,
  row: ClientInsert<T>,
): Tables[T]["Insert"] {
  const clean: Record<string, unknown> = { ...row };
  for (const column of GUARD_SET_COLUMNS[table]) delete clean[column];
  return clean as Tables[T]["Insert"];
}
