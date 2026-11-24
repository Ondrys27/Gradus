import "server-only";
import { lookup } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPublicAddress } from "@/features/scheduler/server/ics-fetch";
import type { Database } from "@/types/database";
import { isMcpLevel, type McpLevel } from "../levels";
import {
  ACCESS_PREFIX,
  ACCESS_TOKEN_TTL_S,
  CODE_PREFIX,
  CODE_TTL_S,
  clientMetadataSchema,
  isMetadataClientId,
  newClientId,
  newSecret,
  REFRESH_PREFIX,
  REFRESH_RETRY_GRACE_S,
  REFRESH_TOKEN_TTL_S,
  redirectHost,
  sha256Hex,
  verifyPkce,
  type RegistrationRequest,
} from "../oauth";
import { endGrantSession, newGrantSession } from "./session";

/**
 * The OAuth store of the MCP server (28.8): clients, grants, codes and
 * tokens, all through the admin client (these tables have no client access
 * at all) and always for the user of the session or the token. Secrets are
 * kept only as SHA-256 hashes.
 */

type Admin = SupabaseClient<Database>;
export type GrantRow = Database["public"]["Tables"]["mcp_grants"]["Row"];
export type ClientRow = Database["public"]["Tables"]["oauth_clients"]["Row"];

const iso = (secondsFromNow: number) => new Date(Date.now() + secondsFromNow * 1000).toISOString();

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export async function registerClient(admin: Admin, request: RegistrationRequest) {
  const id = newClientId();
  const name =
    request.client_name?.trim() || redirectHost(request.redirect_uris[0]) || "MCP client";
  const { error } = await admin.from("oauth_clients").insert({
    id,
    kind: "dcr",
    client_name: name.slice(0, 120),
    client_uri: request.client_uri ?? null,
    redirect_uris: request.redirect_uris,
  });
  if (error) throw error;
  return { id, name, redirectUris: request.redirect_uris };
}

const CIMD_TIMEOUT_MS = 5_000;
const CIMD_MAX_BYTES = 64 * 1024;
const CIMD_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * A client metadata document (CIMD): fetched from its https address on a
 * public IP only, no redirects, 5 s and 64 kB at most; cached for a day.
 */
async function fetchMetadata(clientId: string) {
  const url = new URL(clientId);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || !addresses.every((entry) => isPublicAddress(entry.address))) return null;
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
    headers: { accept: "application/json" },
  }).catch(() => null);
  if (!response?.ok) return null;
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > CIMD_MAX_BYTES) return null;
  const text = await response.text().catch(() => "");
  if (!text || text.length > CIMD_MAX_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = clientMetadataSchema.safeParse(json);
  if (!parsed.success || parsed.data.client_id !== clientId) return null;
  if (parsed.data.token_endpoint_auth_method && parsed.data.token_endpoint_auth_method !== "none")
    return null;
  return parsed.data;
}

/** The client of an authorization request: registered, or its metadata document (CIMD). */
export async function findClient(admin: Admin, clientId: string): Promise<ClientRow | null> {
  const { data, error } = await admin
    .from("oauth_clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  const fresh =
    data &&
    (data.kind === "dcr" ||
      Date.now() - Date.parse(data.fetched_at ?? data.created_at) < CIMD_REFRESH_MS);
  if (fresh) return data;
  if (!isMetadataClientId(clientId)) return data;
  const document = await fetchMetadata(clientId);
  if (!document) return data;
  const row = {
    id: clientId,
    kind: "cimd",
    client_name: document.client_name.slice(0, 120),
    client_uri: document.client_uri ?? null,
    redirect_uris: document.redirect_uris,
    fetched_at: new Date().toISOString(),
  };
  const saved = await admin.from("oauth_clients").upsert(row).select("*").single();
  if (saved.error) throw saved.error;
  return saved.data;
}

// ---------------------------------------------------------------------------
// Consent: the grant and its code
// ---------------------------------------------------------------------------

export async function createGrantWithCode(
  admin: Admin,
  args: {
    userId: string;
    client: ClientRow;
    level: McpLevel;
    spaceIds: string[];
    spaceId: string;
    redirectUri: string;
    codeChallenge: string;
    resource: string;
  },
): Promise<string> {
  const session = await newGrantSession(admin, args.userId);
  const { data: grant, error } = await admin
    .from("mcp_grants")
    .insert({
      user_id: args.userId,
      space_id: args.spaceId,
      space_ids: args.spaceIds,
      client_id: args.client.id,
      client_name: args.client.client_name,
      redirect_host: redirectHost(args.redirectUri),
      level: args.level,
      session_cipher: session,
    })
    .select("id")
    .single();
  if (error) throw error;
  const code = newSecret(CODE_PREFIX);
  const saved = await admin.from("oauth_codes").insert({
    code_hash: sha256Hex(code),
    grant_id: grant.id,
    client_id: args.client.id,
    redirect_uri: args.redirectUri,
    code_challenge: args.codeChallenge,
    resource: args.resource,
    expires_at: iso(CODE_TTL_S),
  });
  if (saved.error) throw saved.error;
  await admin
    .from("oauth_clients")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", args.client.id);
  return code;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type TokenSet = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type TokenError = "invalid_grant" | "invalid_request" | "invalid_client";

async function issueTokens(admin: Admin, grant: GrantRow, resource: string) {
  const access = newSecret(ACCESS_PREFIX);
  const refresh = newSecret(REFRESH_PREFIX);
  const { error } = await admin.from("oauth_tokens").insert([
    {
      token_hash: sha256Hex(access),
      grant_id: grant.id,
      kind: "access",
      resource,
      expires_at: iso(ACCESS_TOKEN_TTL_S),
    },
    {
      token_hash: sha256Hex(refresh),
      grant_id: grant.id,
      kind: "refresh",
      resource,
      expires_at: iso(REFRESH_TOKEN_TTL_S),
    },
  ]);
  if (error) throw error;
  return { access, refresh };
}

async function liveGrant(admin: Admin, grantId: string): Promise<GrantRow | null> {
  const { data, error } = await admin
    .from("mcp_grants")
    .select("*")
    .eq("id", grantId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data && isMcpLevel(data.level) ? data : null;
}

/** authorization_code: the code once, its PKCE verifier, the same client, redirect and resource. */
export async function exchangeCode(
  admin: Admin,
  args: { code: string; clientId: string; redirectUri: string; verifier: string; resource: string },
): Promise<
  | { ok: true; grant: GrantRow; tokens: { access: string; refresh: string } }
  | { ok: false; error: TokenError }
> {
  const now = new Date().toISOString();
  // Claim it: of two uses only one gets it.
  const { data: claimed, error } = await admin
    .from("oauth_codes")
    .update({ used_at: now })
    .eq("code_hash", sha256Hex(args.code))
    .is("used_at", null)
    .gt("expires_at", now)
    .select("*");
  if (error) throw error;
  const code = claimed?.[0];
  if (!code) return { ok: false, error: "invalid_grant" };
  if (
    code.client_id !== args.clientId ||
    code.redirect_uri !== args.redirectUri ||
    code.resource !== args.resource ||
    !verifyPkce(args.verifier, code.code_challenge)
  ) {
    return { ok: false, error: "invalid_grant" };
  }
  const grant = await liveGrant(admin, code.grant_id);
  if (!grant || grant.client_id !== args.clientId) return { ok: false, error: "invalid_grant" };
  const tokens = await issueTokens(admin, grant, code.resource);
  return { ok: true, grant, tokens };
}

/**
 * refresh_token: rotates (the old one is spent, a new pair comes). A spent
 * token used again later than a retry would be is a replay: the whole grant
 * is revoked, as OAuth 2.1 asks for public clients.
 */
export async function refreshTokens(
  admin: Admin,
  args: { refreshToken: string; clientId: string; resource: string | null },
): Promise<
  | { ok: true; grant: GrantRow; tokens: { access: string; refresh: string } }
  | { ok: false; error: TokenError }
> {
  const hash = sha256Hex(args.refreshToken);
  const { data: row, error } = await admin
    .from("oauth_tokens")
    .select("*")
    .eq("token_hash", hash)
    .eq("kind", "refresh")
    .maybeSingle();
  if (error) throw error;
  if (!row || Date.parse(row.expires_at) <= Date.now())
    return { ok: false, error: "invalid_grant" };
  if (args.resource && args.resource !== row.resource) return { ok: false, error: "invalid_grant" };
  const grant = await liveGrant(admin, row.grant_id);
  if (!grant || grant.client_id !== args.clientId) return { ok: false, error: "invalid_grant" };
  if (row.used_at) {
    if (Date.now() - Date.parse(row.used_at) > REFRESH_RETRY_GRACE_S * 1000) {
      await revokeGrant(admin, grant.user_id, grant.id);
    }
    return { ok: false, error: "invalid_grant" };
  }
  const { data: claimed, error: claimError } = await admin
    .from("oauth_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", hash)
    .is("used_at", null)
    .select("token_hash");
  if (claimError) throw claimError;
  if (!claimed?.length) return { ok: false, error: "invalid_grant" };
  const tokens = await issueTokens(admin, grant, row.resource);
  return { ok: true, grant, tokens };
}

/** The grant of a live access token for this resource, or null. */
export async function grantOfAccessToken(
  admin: Admin,
  token: string,
  resource: string,
): Promise<GrantRow | null> {
  const { data: row, error } = await admin
    .from("oauth_tokens")
    .select("grant_id, resource, expires_at")
    .eq("token_hash", sha256Hex(token))
    .eq("kind", "access")
    .maybeSingle();
  if (error) throw error;
  if (!row || Date.parse(row.expires_at) <= Date.now() || row.resource !== resource) return null;
  return liveGrant(admin, row.grant_id);
}

/** RFC 7009: a token of this client ends (a refresh token ends the whole grant). */
export async function revokeToken(admin: Admin, token: string, clientId: string | null) {
  const { data: row } = await admin
    .from("oauth_tokens")
    .select("grant_id, kind")
    .eq("token_hash", sha256Hex(token))
    .maybeSingle();
  if (!row) return;
  const grant = await liveGrant(admin, row.grant_id);
  if (!grant || (clientId && grant.client_id !== clientId)) return;
  if (row.kind === "refresh") await revokeGrant(admin, grant.user_id, grant.id);
  else await admin.from("oauth_tokens").delete().eq("token_hash", sha256Hex(token));
}

/** Disconnect: the grant is revoked, its tokens and codes deleted at once, its session ended. */
export async function revokeGrant(admin: Admin, userId: string, grantId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("mcp_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id, session_cipher");
  if (error) throw error;
  if (!data?.length) return false;
  await Promise.all([
    admin.from("oauth_tokens").delete().eq("grant_id", grantId),
    admin.from("oauth_codes").delete().eq("grant_id", grantId),
  ]);
  await endGrantSession(admin, data[0].session_cipher);
  await admin.from("mcp_grants").update({ session_cipher: null }).eq("id", grantId);
  return true;
}

export async function setGrantLevel(
  admin: Admin,
  userId: string,
  grantId: string,
  level: McpLevel,
): Promise<GrantRow | null> {
  const { data, error } = await admin
    .from("mcp_grants")
    .update({ level })
    .eq("id", grantId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("*");
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function switchGrantSpace(
  admin: Admin,
  grant: GrantRow,
  spaceId: string,
): Promise<boolean> {
  if (!grant.space_ids.includes(spaceId)) return false;
  const { error } = await admin
    .from("mcp_grants")
    .update({ space_id: spaceId })
    .eq("id", grant.id)
    .eq("user_id", grant.user_id);
  if (error) throw error;
  return true;
}

/** One call of a tool, for the history, the count and the "last used". */
export async function recordCall(
  admin: Admin,
  grant: GrantRow,
  call: {
    tool: string;
    level: "read" | "write" | "delete";
    ok: boolean;
    error?: string | null;
    summary?: string | null;
  },
) {
  const now = new Date().toISOString();
  const [{ error }] = await Promise.all([
    admin.from("mcp_calls").insert({
      grant_id: grant.id,
      user_id: grant.user_id,
      space_id: grant.space_id,
      tool: call.tool,
      level: call.level,
      ok: call.ok,
      error:
        call.error && /^[A-Za-z][A-Za-z0-9_]{1,40}$/.test(call.error)
          ? call.error
          : call.ok
            ? null
            : "failed",
      summary: call.summary ? call.summary.slice(0, 300) : null,
    }),
    admin.from("mcp_grants").update({ last_used_at: now }).eq("id", grant.id),
  ]);
  if (error) console.error("mcp: recording a call failed", error.message);
}

/** The rate counter of this minute; true while the grant is within the limit. */
export async function withinRate(admin: Admin, grantId: string, limit: number): Promise<boolean> {
  const { data, error } = await admin.rpc("mcp_rate_hit", { _grant: grantId });
  if (error) {
    console.error("mcp: rate counter failed", error.message);
    return true;
  }
  return (data ?? 0) <= limit;
}
