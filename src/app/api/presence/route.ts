import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The last write of "when I was last here" (30.5), sent with sendBeacon while
 * a tab of the app is being closed: the session's account only, through
 * presence_touch (which writes nothing for an account hiding its status and
 * at most every few seconds). No body, no analytics.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return new Response(null, { status: 401 });
  await supabase.rpc("presence_touch", { _leaving: true });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
