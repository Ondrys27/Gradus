"use server";

import { measure } from "@/lib/analytics/instrument";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PromoProblem } from "./codes";
import {
  checkPromo,
  loadPromoAccountStatus,
  promoFromCookie,
  redeemPromo,
  type PromoAccountStatus,
  type PromoCheck,
  type PromoRedeemed,
} from "./server/promo";

/**
 * The promo code field of the registration, the onboarding and Settings →
 * Subscription. Checking a code needs no account (the registration form
 * asks before there is one) and never names the partner. Redeeming and the
 * account's status are the workspace owner's only (a worker pays for
 * nothing), with the user id from the session.
 */

export type PromoActionProblem = PromoProblem | "ownerOnly" | "unavailable";
export type PromoCheckResult = PromoCheck | { ok: false; problem: "unavailable" };
export type PromoRedeemResult = PromoRedeemed | { ok: false; problem: "ownerOnly" | "unavailable" };

export type PromoStatus = PromoAccountStatus & {
  /** The owner may still enter a code: none yet and nothing paid. */
  eligible: boolean;
  /** A code a partner's link left in this browser, to prefill the field. */
  suggested: string | null;
};

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

/** The session's user when they are the owner of the workspace they work in. */
async function ownerId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || !userId) return null;
  const { data: workspaceId, error } = await supabase.rpc("current_workspace_id");
  if (error) throw error;
  return workspaceId === userId ? userId : null;
}

export async function redeemPromoCode(
  input: string,
  source: "signup" | "settings",
): Promise<PromoRedeemResult> {
  return measure("promo.redeem", async (): Promise<PromoRedeemResult> => {
    try {
      const userId = await ownerId();
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

export async function loadPromoStatus(): Promise<PromoStatus | null> {
  return measure("promo.status", async (): Promise<PromoStatus | null> => {
    try {
      const userId = await ownerId();
      if (!userId) return null;
      const status = await loadPromoAccountStatus(userId, createAdminClient());
      const eligible = !status.redemption && !status.paid;
      return { ...status, eligible, suggested: eligible ? await promoFromCookie() : null };
    } catch (error) {
      console.error("[promo] status failed", error);
      return null;
    }
  })();
}
