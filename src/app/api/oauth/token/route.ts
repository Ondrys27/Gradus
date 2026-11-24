import { scopeString, type McpLevel } from "@/features/mcp/levels";
import {
  ACCESS_TOKEN_TTL_S,
  canonicalResource,
  oauthError,
  originOf,
  resourceMatches,
} from "@/features/mcp/oauth";
import { formOf, json, preflight } from "@/features/mcp/server/http";
import { exchangeCode, refreshTokens } from "@/features/mcp/server/store";
import { trackLater } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The token endpoint (28.8): authorization_code with PKCE S256 and
 * refresh_token with rotation, for public clients (client_id, no secret).
 * Tokens are bound to the grant (person, companies, level) and to the
 * resource /api/mcp of this app.
 */
export async function POST(request: Request) {
  const form = await formOf(request);
  const origin = originOf(request);
  const clientId = form.client_id;
  if (!clientId) return json(oauthError("invalid_client", "client_id is required."), 401);
  if (!resourceMatches(form.resource, origin)) {
    return json(oauthError("invalid_target", "Unknown resource."), 400);
  }
  const resource = canonicalResource(origin);
  const admin = createAdminClient();

  if (form.grant_type === "authorization_code") {
    if (!form.code || !form.redirect_uri || !form.code_verifier) {
      return json(
        oauthError("invalid_request", "code, redirect_uri and code_verifier are required."),
        400,
      );
    }
    const result = await exchangeCode(admin, {
      code: form.code,
      clientId,
      redirectUri: form.redirect_uri,
      verifier: form.code_verifier,
      resource,
    });
    if (!result.ok) return json(oauthError(result.error), 400);
    trackLater(
      "mcp_client_connected",
      {
        level: result.grant.level as McpLevel,
        companies: result.grant.space_ids.length,
        own: result.grant.space_id === result.grant.user_id,
      },
      { userId: result.grant.user_id },
    );
    return json({
      access_token: result.tokens.access,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: result.tokens.refresh,
      scope: scopeString(result.grant.level as McpLevel),
    });
  }

  if (form.grant_type === "refresh_token") {
    if (!form.refresh_token)
      return json(oauthError("invalid_request", "refresh_token is required."), 400);
    const result = await refreshTokens(admin, {
      refreshToken: form.refresh_token,
      clientId,
      resource: form.resource ? resource : null,
    });
    if (!result.ok) return json(oauthError(result.error), 400);
    return json({
      access_token: result.tokens.access,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: result.tokens.refresh,
      scope: scopeString(result.grant.level as McpLevel),
    });
  }

  return json(oauthError("unsupported_grant_type"), 400);
}

export const OPTIONS = preflight;
