import { NextResponse } from "next/server";
import { loadPromoStatus } from "@/features/promo/server/promo";
import { instrumentRoute } from "@/lib/analytics/instrument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The promo code of the signed-in workspace owner for the onboarding and
 * Settings → Subscription: the code the account uses, or whether one can
 * still be entered (with a partner's link code to prefill). `null` for a
 * worker or a signed-out request. Never names the partner.
 */
export const GET = instrumentRoute("api.promo.status", async () => {
  try {
    const status = await loadPromoStatus();
    return NextResponse.json({ status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[promo] status failed", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
});
