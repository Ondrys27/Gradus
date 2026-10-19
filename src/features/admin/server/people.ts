import "server-only";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayName, type PersonInfo } from "../display-name";

/**
 * Names and e-mails of the people the administration shows, read in one call
 * (admin_people, service role only) for the ids already on the page. Used only
 * to label rows for the owner; never passed to analytics or usage_events.
 */

const MAX_IDS = 500;

export async function loadPeople(ids: Iterable<string | null | undefined>): Promise<Map<string, PersonInfo>> {
  const unique = [...new Set([...ids].filter((id): id is string => !!id))].slice(0, MAX_IDS);
  if (!unique.length) return new Map();
  const { data, error } = await createAdminClient().rpc("admin_people", { _ids: unique });
  if (error) throw new Error(`admin_people: ${error.message}`);
  return new Map(
    (data ?? []).map((row) => [row.user_id, { name: row.display_name, email: row.email }]),
  );
}

export type NameOf = (id: string) => string;

/**
 * A function that names any of the given ids the way the administration shows
 * people. If the names cannot be read, the page still renders: every person
 * falls back to "Unnamed account" with the end of the id.
 */
export async function peopleNamer(ids: Iterable<string | null | undefined>): Promise<NameOf> {
  const [people, t] = await Promise.all([
    loadPeople(ids).catch((error: unknown) => {
      console.error("[admin] people names unavailable", error);
      return new Map<string, PersonInfo>();
    }),
    getTranslations("admin.people"),
  ]);
  const unnamed = (suffix: string) => t("unnamed", { suffix });
  return (id) => displayName(id, people.get(id), unnamed);
}
