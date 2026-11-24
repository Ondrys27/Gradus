import { oauthError, registrationSchema } from "@/features/mcp/oauth";
import { json, preflight } from "@/features/mcp/server/http";
import { registerClient } from "@/features/mcp/server/store";
import { trackLater } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Registrations per minute for the whole app; a flood waits (unused clients go after 30 days). */
const REGISTRATIONS_PER_MINUTE = 30;

/**
 * RFC 7591 dynamic client registration (28.8): public clients only (no
 * secret, PKCE), redirects on https or the loopback. A client is only a name
 * and its redirects; access comes from the person's consent alone.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(oauthError("invalid_client_metadata", "The body must be JSON."), 400);
  }
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    const redirect = parsed.error.issues.some((issue) => issue.path[0] === "redirect_uris");
    return json(
      oauthError(
        redirect ? "invalid_redirect_uri" : "invalid_client_metadata",
        parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      ),
      400,
    );
  }
  const admin = createAdminClient();
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin
    .from("oauth_clients")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if ((count ?? 0) >= REGISTRATIONS_PER_MINUTE) {
    return json(oauthError("temporarily_unavailable", "Try again in a minute."), 429, {
      "retry-after": "60",
    });
  }
  const client = await registerClient(admin, parsed.data);
  trackLater("mcp_client_registered", {}, { userId: null });
  return json(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

export const OPTIONS = preflight;
