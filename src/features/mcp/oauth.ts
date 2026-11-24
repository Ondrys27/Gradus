import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { MCP_SCOPES } from "./levels";

/**
 * The OAuth 2.1 authorization server of Gradus for MCP clients (28.8), as
 * pure rules: discovery documents (RFC 9728, RFC 8414), dynamic client
 * registration (RFC 7591) and client metadata documents (CIMD), the
 * authorization code with PKCE S256, the resource indicator (RFC 8707) and
 * token lifetimes. The routes and the store do the I/O.
 */

/** The MCP endpoint, the resource every token is for. */
export const MCP_PATH = "/api/mcp";
export const AUTHORIZE_PATH = "/oauth/authorize";
export const TOKEN_PATH = "/api/oauth/token";
export const REGISTER_PATH = "/api/oauth/register";
export const REVOKE_PATH = "/api/oauth/revoke";
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
export const AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server";

export const ACCESS_TOKEN_TTL_S = 60 * 60;
export const REFRESH_TOKEN_TTL_S = 60 * 24 * 60 * 60;
export const CODE_TTL_S = 5 * 60;
/** A refresh token used again within this window is a retry, not a replay. */
export const REFRESH_RETRY_GRACE_S = 60;
/** Calls of one connected client per minute (against a loop; not a daily cap). */
export const MCP_CALLS_PER_MINUTE = 120;

export const ACCESS_PREFIX = "gat_";
export const REFRESH_PREFIX = "grt_";
export const CODE_PREFIX = "gac_";

/** Claude's redirect for remote connectors (claude.ai now, claude.com announced). */
export const CLAUDE_CALLBACKS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
] as const;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** An opaque secret: 32 random bytes in base64url behind a short prefix. */
export function newSecret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function newClientId(): string {
  return `gmcp_${randomBytes(18).toString("base64url")}`;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/** The resource of this server: its origin + /api/mcp, no trailing slash. */
export function canonicalResource(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${MCP_PATH}`;
}

/** The `resource` a client sent is this server (missing = this server). */
export function resourceMatches(given: string | null | undefined, origin: string): boolean {
  if (!given) return true;
  return given.replace(/\/+$/, "") === canonicalResource(origin);
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parsed(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

/** A redirect a client may register: https, or http on the loopback (native apps); no fragment. */
export function validRedirectUri(uri: string): boolean {
  if (uri.length > 512) return false;
  const url = parsed(uri);
  if (!url || url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * The redirect of an authorization request is one the client registered:
 * the same string, or on the loopback the same address on any port (RFC 8252).
 */
export function redirectAllowed(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const asked = parsed(requested);
  if (!asked || asked.protocol !== "http:" || !LOOPBACK_HOSTS.has(asked.hostname)) return false;
  return registered.some((uri) => {
    const known = parsed(uri);
    return (
      known !== null &&
      known.protocol === "http:" &&
      known.hostname === asked.hostname &&
      known.pathname === asked.pathname &&
      known.search === asked.search
    );
  });
}

/** The host shown on the consent screen ("…will return to claude.ai"). */
export function redirectHost(uri: string): string | null {
  return parsed(uri)?.host ?? null;
}

/** Where the browser goes back: the redirect with the code (or the error), the state and the issuer. */
export function redirectWith(
  redirectUri: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function verifyPkce(verifier: string | null | undefined, challenge: string): boolean {
  if (!verifier || !VERIFIER.test(verifier)) return false;
  return pkceChallenge(verifier) === challenge;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);
const httpsUrl = z
  .string()
  .max(512)
  .refine((value) => parsed(value)?.protocol === "https:", "https address");

/** Dynamic client registration: public clients only (no secret), the code flow only. */
export const registrationSchema = z.object({
  redirect_uris: z.array(z.string().refine(validRedirectUri, "redirect")).min(1).max(10),
  client_name: text(120).optional(),
  client_uri: httpsUrl.optional(),
  logo_uri: httpsUrl.optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .optional()
    .refine((grants) => !grants || grants.includes("authorization_code"), "authorization_code"),
  response_types: z.array(z.literal("code")).optional(),
  scope: z.string().max(200).optional(),
  application_type: z.enum(["web", "native"]).optional(),
  software_id: z.string().max(200).optional(),
  software_version: z.string().max(100).optional(),
});
export type RegistrationRequest = z.infer<typeof registrationSchema>;

/** A client metadata document (CIMD): its client_id is its own address. */
export const clientMetadataSchema = z.object({
  client_id: z.string(),
  client_name: text(120),
  client_uri: httpsUrl.optional(),
  redirect_uris: z.array(z.string().refine(validRedirectUri, "redirect")).min(1).max(10),
  token_endpoint_auth_method: z.string().optional(),
});

/** A client_id that is a metadata document's address (CIMD) rather than a registered id. */
export function isMetadataClientId(clientId: string): boolean {
  const url = parsed(clientId);
  return (
    url !== null &&
    url.protocol === "https:" &&
    url.pathname.length > 1 &&
    !url.hash &&
    !url.username &&
    clientId.length <= 512
  );
}

export const authorizeSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(512),
  redirect_uri: z.string().min(1).max(512),
  code_challenge: z.string().regex(CHALLENGE),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(1024).optional(),
  scope: z.string().max(200).optional(),
  resource: z.string().max(512).optional(),
});
export type AuthorizeRequest = z.infer<typeof authorizeSchema>;

/** The query of /oauth/authorize as an object (repeated keys = the first one). */
export function authorizeParams(
  search: URLSearchParams | Record<string, string | string[] | undefined>,
) {
  const out: Record<string, string> = {};
  if (search instanceof URLSearchParams) {
    for (const [key, value] of search) if (!(key in out)) out[key] = value;
  } else {
    for (const [key, value] of Object.entries(search)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string") out[key] = first;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export function protectedResourceMetadata(origin: string) {
  return {
    resource: canonicalResource(origin),
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Gradus",
    resource_documentation: `${origin}/#funkce`,
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    registration_endpoint: `${origin}${REGISTER_PATH}`,
    revocation_endpoint: `${origin}${REVOKE_PATH}`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/** The challenge of a 401 / 403 from the MCP endpoint (RFC 6750, RFC 9728). */
export function wwwAuthenticate(
  origin: string,
  error?: { code: "invalid_token" | "insufficient_scope"; scope?: string },
): string {
  const parts = [`resource_metadata="${origin}${PROTECTED_RESOURCE_PATH}${MCP_PATH}"`];
  if (error) parts.unshift(`error="${error.code}"`);
  parts.push(`scope="${error?.scope ?? MCP_SCOPES.join(" ")}"`);
  return `Bearer ${parts.join(", ")}`;
}

/** An OAuth error body (RFC 6749 §5.2). */
export function oauthError(error: string, description?: string) {
  return { error, ...(description ? { error_description: description } : {}) };
}

/** The bearer token of a request, or null. */
export function bearerOf(header: string | null): string | null {
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]{16,512})\s*$/i.exec(header ?? "");
  return match ? match[1] : null;
}

/**
 * The public origin of a request (behind Vercel the forwarded host), so the
 * discovery documents name the address the person typed into Claude.
 */
export function originOf(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (host && /^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) {
    const scheme = proto === "http" || proto === "https" ? proto : url.protocol.replace(":", "");
    return `${scheme}://${host}`;
  }
  return url.origin;
}
