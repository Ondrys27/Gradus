import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { spaceHeaders } from "@/features/account/space-cookie";
import { decryptSecret, encryptSecret } from "@/features/scheduler/server/crypto";
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/env";
import { VIA_HEADER } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Admin = SupabaseClient<Database>;
export type UserDb = SupabaseClient<Database>;

/** The header naming the connected client on the company's activity (activity_mcp_grant()). */
export const MCP_GRANT_HEADER = "x-gradus-mcp-grant";

/**
 * The connected client acts as the person, never as the admin: each grant
 * keeps a Supabase session of its own (made for it on the consent and
 * renewed with its refresh token), sealed with INTEGRATIONS_ENCRYPTION_KEY
 * in mcp_grants.session_cipher. Every call of the MCP server uses that
 * session's access token, so row level security, the guards and read-only
 * mode decide exactly as in the app. The admin client only mints the
 * session (a sign-in link verified on the server, never sent anywhere) and
 * stores it.
 */

type StoredSession = { a: string; r: string; e: number };

/** Renew a little before the end, so a call never starts with a dying token. */
const RENEW_BEFORE_S = 120;

function anonClient(): UserDb {
  return createSupabaseClient<Database>(supabaseUrl(), supabasePublicKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function seal(session: { access_token: string; refresh_token: string; expires_at?: number }) {
  const expires = session.expires_at ?? Math.floor(Date.now() / 1000) + 3600;
  return encryptSecret(
    JSON.stringify({ a: session.access_token, r: session.refresh_token, e: expires }),
  );
}

function unseal(cipher: string | null): StoredSession | null {
  if (!cipher) return null;
  try {
    const value = JSON.parse(decryptSecret(cipher)) as StoredSession;
    return typeof value.a === "string" && typeof value.r === "string" ? value : null;
  } catch {
    return null;
  }
}

/** A fresh Supabase session of the account, made on the server for one grant. */
export async function mintSession(admin: Admin, userId: string) {
  const { data: user, error } = await admin.auth.admin.getUserById(userId);
  if (error || !user.user?.email) throw new Error("mcp: account not found");
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user.email });
  const token = link.data.properties?.hashed_token;
  if (link.error || !token) throw new Error("mcp: no sign-in token");
  const { data, error: verifyError } = await anonClient().auth.verifyOtp({
    type: "magiclink",
    token_hash: token,
  });
  if (verifyError || !data.session) throw new Error("mcp: the session could not be made");
  return data.session;
}

/** The sealed session of a new grant. */
export async function newGrantSession(admin: Admin, userId: string): Promise<string> {
  return seal(await mintSession(admin, userId));
}

/** Ends the grant's session at Supabase (disconnecting); a failure only goes to the log. */
export async function endGrantSession(admin: Admin, cipher: string | null): Promise<void> {
  const session = unseal(cipher);
  if (!session) return;
  const { error } = await admin.auth.admin.signOut(session.a, "local");
  if (error) console.error("mcp: ending the session failed", error.message);
}

/** The access token of a grant's session, renewed (and stored again) when it is near its end. */
export async function grantAccessToken(
  admin: Admin,
  grant: { id: string; user_id: string; session_cipher: string | null },
): Promise<string> {
  const stored = unseal(grant.session_cipher);
  const now = Math.floor(Date.now() / 1000);
  if (stored && stored.e - RENEW_BEFORE_S > now) return stored.a;

  let session: { access_token: string; refresh_token: string; expires_at?: number } | null = null;
  if (stored) {
    const { data, error } = await anonClient().auth.refreshSession({ refresh_token: stored.r });
    if (!error && data.session) session = data.session;
  }
  // Ended elsewhere ("sign out everywhere") or never made: a new one for this grant.
  if (!session) session = await mintSession(admin, grant.user_id);
  const { error } = await admin
    .from("mcp_grants")
    .update({ session_cipher: seal(session) })
    .eq("id", grant.id)
    .eq("user_id", grant.user_id);
  if (error) console.error("mcp: storing the session failed", error.message);
  return session.access_token;
}

/**
 * The person's own client for one call: their session's token, the grant's
 * company as the active space, and the labels of the step ("through Claude").
 */
export function userClient(accessToken: string, spaceId: string, grantId: string): UserDb {
  return createSupabaseClient<Database>(supabaseUrl(), supabasePublicKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...spaceHeaders(spaceId),
        [VIA_HEADER]: "mcp",
        [MCP_GRANT_HEADER]: grantId,
      },
    },
  });
}
