import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { GUIDE_SECTIONS, isGuideSection } from "@/features/tutorial/ui-map/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The person's own settings of the guide (30.8): `guide_offers` and
 * `guide_seen` of user_settings, read and written with the user's own client
 * (RLS: only their own row). Through the server so that, until the migration
 * of 30.8 is applied and the columns exist, the browser gets the defaults
 * (`stored: false`) instead of a failed request in its console.
 */

const patchSchema = z.object({
  offers: z.boolean().optional(),
  seen: z.array(z.enum(GUIDE_SECTIONS as unknown as [string, ...string[]])).max(40).optional(),
});

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  // The generated types gain the columns of 30.8 only after the migration (db:types).
  return userId ? { supabase: supabase as unknown as SupabaseClient, userId } : null;
}

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const ctx = await session();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await ctx.supabase
    .from("user_settings")
    .select("guide_offers, guide_seen")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ offers: true, seen: [], stored: false }, { headers: noStore });
  const row = data as { guide_offers?: unknown; guide_seen?: unknown };
  return NextResponse.json(
    {
      offers: typeof row.guide_offers === "boolean" ? row.guide_offers : true,
      seen: Array.isArray(row.guide_seen) ? row.guide_seen.filter(isGuideSection) : [],
      stored: true,
    },
    { headers: noStore },
  );
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const ctx = await session();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (parsed.data.offers !== undefined) patch.guide_offers = parsed.data.offers;
  if (parsed.data.seen) patch.guide_seen = [...new Set(parsed.data.seen)];
  if (Object.keys(patch).length === 0) return new Response(null, { status: 204 });
  const { error } = await ctx.supabase.from("user_settings").update(patch).eq("user_id", ctx.userId);
  // Before the migration the browser keeps them; nothing to tell the user.
  return NextResponse.json({ stored: !error }, { headers: noStore });
}
