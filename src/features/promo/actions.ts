"use server";

import { codeGuard, codesLocked, recordWrongCode } from "@/features/auth/code-attempts-server";
import { measure } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";
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

export type PromoActionProblem = PromoProblem | "ownerOnly" | "unavailable" | "tooManyAttempts";
export type PromoCheckResult = PromoCheck | { ok: false; problem: "unavailable" | "tooManyAttempts" };
export type PromoRedeemResult =
  | PromoRedeemed
  | { ok: false; problem: "ownerOnly" | "unavailable" | "tooManyAttempts" };

const MAX_INPUT = 64;

export async function checkPromoCode(input: string): Promise<PromoCheckResult> {
  return measure("promo.check", async (): Promise<PromoCheckResult> => {
    try {
      // Guessing codes while typing is held back per address (code-attempts.ts).
      const admin = createAdminClient();
      const guard = await codeGuard(null);
      if (await codesLocked(guard, admin)) return { ok: false, problem: "tooManyAttempts" };
      const result = await checkPromo(String(input ?? "").slice(0, MAX_INPUT), admin);
      if (!result.ok && result.problem === "not_found") await recordWrongCode(guard, "promo", "check", admin);
      return result;
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
      // The onboarding right after the registration counts as the sign-up;
      // once it is done, the code comes from the settings whatever the
      // browser says (the settings refuse extra trial days without a trial).
      const admin = createAdminClient();
      let where: "signup" | "settings" = "settings";
      if (source === "signup") {
        const { data: profile, error } = await admin
          .from("profiles")
          .select("onboarding_completed_at")
          .eq("id", userId)
          .maybeSingle();
        if (error) throw error;
        if (profile && !profile.onboarding_completed_at) where = "signup";
      }
      const guard = await codeGuard({ account: userId });
      if (await codesLocked(guard, admin)) return { ok: false, problem: "tooManyAttempts" };
      const result = await redeemPromo(userId, String(input ?? "").slice(0, MAX_INPUT), where, admin);
      if (!result.ok && result.problem === "not_found") await recordWrongCode(guard, "promo", "submit", admin);
      return result;
    } catch (error) {
      console.error("[promo] redeem failed", error);
      return { ok: false, problem: "unavailable" };
    }
  })();
}
