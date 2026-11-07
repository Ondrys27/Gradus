import "server-only";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayName, type PersonInfo } from "../display-name";

/**
 * Names and e-mails of the people the administration shows, read in one call
 * (admin_people, service role only) for the ids already on the page. Used only
 * to label rows for the owner; never passed to analytics or usage_events.
 */

/** admin_people answers for at most this many ids at once; more go in batches. */
const BATCH = 500;
/** The most ids one page or export names (the CSV of accounts). */
const MAX_IDS = 5000;

export async function loadPeople(ids: Iterable<string | null | undefined>): Promise<Map<string, PersonInfo>> {
  const unique = [...new Set([...ids].filter((id): id is string => !!id))].slice(0, MAX_IDS);
  const people = new Map<string, PersonInfo>();
  for (let start = 0; start < unique.length; start += BATCH) {
    const { data, error } = await createAdminClient().rpc("admin_people", {
      _ids: unique.slice(start, start + BATCH),
    });
    if (error) throw new Error(`admin_people: ${error.message}`);
    for (const row of data ?? []) {
      people.set(row.user_id, { name: row.display_name, email: row.email });
    }
  }
  return people;
}

export type NameOf = (id: string) => string;

/**
 * A function that names any of the given ids the way the administration shows
 * people. If the names cannot be read, the page still renders: every person
 * falls back to "Unnamed account" with the end of the id.
 */
export async function peopleNamer(ids: Iterable<string | null | undefined>): Promise<NameOf> {
  return (await peopleDirectory(ids)).nameOf;
}

/**
 * Names and sign-in e-mails of the given ids, for the pages that show both
 * (the list of accounts and its export, for support). `emailOf` is null when
 * there is no address or the names could not be read.
 */
export async function peopleDirectory(
  ids: Iterable<string | null | undefined>,
  /** An export must not leave the e-mails out quietly: it fails instead. */
  options: { strict?: boolean } = {},
): Promise<{ nameOf: NameOf; emailOf: (id: string) => string | null }> {
  const [people, t] = await Promise.all([
    loadPeople(ids).catch((error: unknown) => {
      if (options.strict) throw error;
      console.error("[admin] people names unavailable", error);
      return new Map<string, PersonInfo>();
    }),
    getTranslations("admin.people"),
  ]);
  const unnamed = (suffix: string) => t("unnamed", { suffix });
  return {
    nameOf: (id) => displayName(id, people.get(id), unnamed),
    emailOf: (id) => people.get(id)?.email ?? null,
  };
}
