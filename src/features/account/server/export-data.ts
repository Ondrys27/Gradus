import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { strToU8, zipSync, type Zippable } from "fflate";
import type { Database } from "@/types/database";
import { EXPORT_TABLES, toCsv } from "../data-export";

type Client = SupabaseClient<Database>;

/** Rows per request; the export reads every page of every table. */
export const EXPORT_PAGE_SIZE = 1000;

/**
 * Reads the account's rows table by table with the user's own client (row
 * security on top of the owner filter) and packs one CSV per table into a
 * ZIP. A failed read fails the whole export: a partial copy must not look
 * complete.
 */
export async function buildAccountExport(
  supabase: Client,
  userId: string,
): Promise<{ zip: Uint8Array; rows: number; tables: number }> {
  const files: Zippable = {};
  let total = 0;
  for (const spec of EXPORT_TABLES) {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
      // The table and its columns come from EXPORT_TABLES, typed against the schema.
      const { data, error } = await supabase
        .from(spec.table as "milestones")
        .select(spec.columns.join(","))
        .eq(spec.owner as "user_id", userId)
        .order("id")
        .range(from, from + EXPORT_PAGE_SIZE - 1);
      if (error) throw new Error(`export of ${spec.table} failed: ${error.message}`);
      const page = (data ?? []) as unknown as Record<string, unknown>[];
      rows.push(...page);
      if (page.length < EXPORT_PAGE_SIZE) break;
    }
    total += rows.length;
    files[`${spec.file}.csv`] = strToU8(toCsv(spec.columns, rows));
  }
  return { zip: zipSync(files, { level: 6 }), rows: total, tables: EXPORT_TABLES.length };
}
