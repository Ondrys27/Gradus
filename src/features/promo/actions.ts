"use server";

import { measure } from "@/lib/analytics/instrument";
import type { PromoProblem } from "./codes";
import {
  checkPromo,
  redeemPromo,
  sessionOwnerId,
  type PromoCheck,
  type PromoRedeemed,
} from "./server/promo";

/**
 * The promo code field of the registration, the onboarding and Settings →
 * Subscription. Checking a code needs no account (the registration form
 * asks before there is one) and never names the partner. Redeeming is the
 * workspace owner's only (a worker pays for nothing), with the user id from
 * the session. The account's status is read through GET /api/promo/status
 * (a plain request, so it never waits behind other server actions).
 */

export type PromoActionProblem = PromoProblem | "ownerOnly" | "unavailable";
export type PromoCheckResult = PromoCheck | { ok: false; problem: "unavailable" };
export type PromoRedeemResult = PromoRedeemed | { ok: false; problem: "ownerOnly" | "unavailable" };

const MAX_INPUT = 64;

export async function checkPromoCode(input: string): Promise<PromoCheckResult> {
  return measure("promo.check", async (): Promise<PromoCheckResult> => {
    try {
      return await checkPromo(String(input ?? "").slice(0, MAX_INPUT));
    } catch (error) {
      console.error("[promo] check failed", error);
      return { ok: false, problem: "unavailable" };
    }
  })();
}


export async function redeemPromoCode(
  input: string,
  source: "signup" | "settings",
): Promise<PromoRedeemResult> {
  return measure("promo.redeem", async (): Promise<PromoRedeemResult> => {
    try {
      const userId = await sessionOwnerId();
      if (!userId) return { ok: false, problem: "ownerOnly" };
      // The onboarding right after the registration counts as the sign-up.
      const where = source === "signup" ? "signup" : "settings";
      return await redeemPromo(userId, String(input ?? "").slice(0, MAX_INPUT), where);
    } catch (error) {
      console.error("[promo] redeem failed", error);
      return { ok: false, problem: "unavailable" };
    }
  })();
}
