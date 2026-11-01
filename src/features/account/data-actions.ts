"use server";

import { track } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { deleteAccount, type DeleteAccountError } from "./server/delete-account";

export type DeleteAccountState = { error?: DeleteAccountError; deleted?: boolean };

/**
 * "Delete account" (Settings → Account): the account of the session, after
 * the user typed its e-mail. On success the session is cleared; the browser
 * then leaves for the sign-in page.
 */
export async function deleteAccountAction(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user?.email) return { error: "generic" };

  const admin = createAdminClient();
  const result = await deleteAccount({
    admin,
    user: { id: user.id, email: user.email },
    typedEmail: String(formData.get("email") ?? ""),
  });
  if (!result.ok) return { error: result.error };

  // The account is gone: recorded without it, and its cookies cleared here.
  await track("account_deleted", { files: result.files }, { userId: null, admin });
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  return { deleted: true };
}
