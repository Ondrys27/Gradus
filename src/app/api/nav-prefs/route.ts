import { NextResponse } from "next/server";
import { z } from "zod";
import { NAV_DEFAULT_ORDER, parseNavPrefs } from "@/components/layout/nav-prefs";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The person's own menu (30.9): `user_settings.nav_prefs`, read and written
 * with the user's own client (RLS: only their own row). Through the server so
 * that, until the migration of 30.9 is applied and the column exists, the
 * browser gets the default menu (`stored: false`) instead of a failed request
 * in its console; the browser keeps a copy of its own meanwhile.
 */

const navKey = z.enum(NAV_DEFAULT_ORDER as unknown as [string, ...string[]]);
const prefsSchema = z.object({
  pinned: z.array(navKey).max(30),
  hidden: z.array(navKey).max(30),
  order: z.array(navKey).max(30),
});

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return userId ? { supabase, userId } : null;
}

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const ctx = await session();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await ctx.supabase
    .from("user_settings")
    .select("nav_prefs")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ ...parseNavPrefs(null), stored: false }, { headers: noStore });
  }
  return NextResponse.json({ ...parseNavPrefs(data.nav_prefs), stored: true }, { headers: noStore });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const ctx = await session();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = prefsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const prefs = parseNavPrefs(parsed.data);
  const { error } = await ctx.supabase
    .from("user_settings")
    .update({ nav_prefs: prefs })
    .eq("user_id", ctx.userId);
  // Before the migration the browser keeps it; nothing to tell the user.
  return NextResponse.json({ stored: !error }, { headers: noStore });
}
