import { formOf, json, preflight } from "@/features/mcp/server/http";
import { revokeToken } from "@/features/mcp/server/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 7009: the client ends a token (a refresh token ends the whole connection). Always 200. */
export async function POST(request: Request) {
  const form = await formOf(request);
  if (form.token) await revokeToken(createAdminClient(), form.token, form.client_id ?? null);
  return json({});
}

export const OPTIONS = preflight;
