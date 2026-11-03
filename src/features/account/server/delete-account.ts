import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { sameEmail } from "../same-email";

type Client = SupabaseClient<Database>;

/** Why the account was not deleted; translation keys under settings.data.delete.errors. */
export type DeleteAccountError = "emailMismatch" | "app_owner" | "active_workers" | "generic";
export type DeleteAccountResult =
  { ok: true; files: number } | { ok: false; error: DeleteAccountError };

const BLOCKERS = ["app_owner", "active_workers"] as const;
/** The Storage API removes at most this many files per call. */
const REMOVE_BATCH = 100;

function blockerOf(value: unknown): (typeof BLOCKERS)[number] | null {
  const text = String((value as { message?: unknown } | null)?.message ?? value ?? "");
  return BLOCKERS.find((code) => text.includes(code)) ?? null;
}

/**
 * Deletes the signed-in account for good, in this order, so that a failure
 * leaves the account usable and the step can be repeated:
 * 1. the typed e-mail must be the account's,
 * 2. nothing blocks it (the app owner; an owner with active workers),
 * 3. the account's files leave storage (every bucket keeps them under the
 *    user's id),
 * 4. analytics lose the person, a worker record in someone's team turns
 *    inactive (account_prepare_deletion),
 * 5. Supabase Auth deletes the user; the foreign keys take every row of the
 *    account with it and only unlink rows of other accounts.
 * `user` always comes from the session, never from the request.
 */
export async function deleteAccount(input: {
  admin: Client;
  user: { id: string; email: string };
  typedEmail: string;
}): Promise<DeleteAccountResult> {
  const { admin, user } = input;
  if (!sameEmail(input.typedEmail, user.email)) return { ok: false, error: "emailMismatch" };

  const blockers = await admin.rpc("account_deletion_blockers", { _user: user.id });
  if (blockers.error) {
    console.error("[account] deletion blockers failed", blockers.error);
    return { ok: false, error: "generic" };
  }
  const blocked = (blockers.data ?? []).map(blockerOf).find(Boolean);
  if (blocked) return { ok: false, error: blocked };

  const objects = await admin.rpc("account_storage_objects", { _user: user.id });
  if (objects.error) {
    console.error("[account] listing files failed", objects.error);
    return { ok: false, error: "generic" };
  }
  const byBucket = new Map<string, string[]>();
  for (const { bucket_id, name } of objects.data ?? []) {
    if (!name.startsWith(`${user.id}/`)) continue;
    byBucket.set(bucket_id, [...(byBucket.get(bucket_id) ?? []), name]);
  }
  let files = 0;
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += REMOVE_BATCH) {
      const batch = names.slice(i, i + REMOVE_BATCH);
      const { error } = await admin.storage.from(bucket).remove(batch);
      if (error) {
        console.error(`[account] removing files from ${bucket} failed`, error);
        return { ok: false, error: "generic" };
      }
      files += batch.length;
    }
  }

  const prepared = await admin.rpc("account_prepare_deletion", { _user: user.id });
  if (prepared.error) {
    const code = blockerOf(prepared.error);
    if (!code) console.error("[account] preparing the deletion failed", prepared.error);
    return { ok: false, error: code ?? "generic" };
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[account] deleting the user failed", error);
    return { ok: false, error: "generic" };
  }
  return { ok: true, files };
}
