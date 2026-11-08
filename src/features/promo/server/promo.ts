import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { fingerprint } from "@/features/admin/server/request-info";
import { track } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import {
  isPromoCode,
  normalizePromoCode,
  PROMO_BENEFITS,
  PROMO_COOKIE,
  PROMO_PROBLEMS,
  type PromoBenefitKind,
  type PromoProblem,
  type PromoSource,
} from "../codes";

/**
 * Checking and redeeming promo codes on the server. promo_codes,
 * promo_redemptions and partner_payouts are closed to every client; the
 * database functions run with the admin client, always for the user id the
 * caller took from the session. A code that cannot be used comes back as a
 * problem key, never as an exception.
 */

type Admin = SupabaseClient<Database>;

export type PromoOffer = { code: string; benefit: PromoBenefitKind; value: number };

export type PromoCheck = { ok: true; offer: PromoOffer } | { ok: false; problem: PromoProblem };

type DbAnswer = {
  status?: string;
  code?: string;
  benefit?: string;
  benefit_value?: number;
  trial_extended?: boolean;
  trial_ends_at?: string | null;
};

const isProblem = (value: unknown): value is PromoProblem =>
  (PROMO_PROBLEMS as readonly string[]).includes(String(value));
const isBenefit = (value: unknown): value is PromoBenefitKind =>
  (PROMO_BENEFITS as readonly string[]).includes(String(value));

function toCheck(answer: DbAnswer | null): PromoCheck {
  if (answer?.status === "ok" && answer.code && isBenefit(answer.benefit)) {
    return {
      ok: true,
      offer: {
        code: answer.code,
        benefit: answer.benefit,
        value: Number(answer.benefit_value ?? 0),
      },
    };
  }
  return { ok: false, problem: isProblem(answer?.status) ? answer.status : "not_found" };
}

/** What a code typed into a form gives, or why it cannot be used. */
export async function checkPromo(
  input: string,
  admin: Admin = createAdminClient(),
): Promise<PromoCheck> {
  const code = normalizePromoCode(input);
  if (!isPromoCode(code)) return { ok: false, problem: "invalid" };
  const { data, error } = await admin.rpc("promo_check", { _code: code });
  if (error) throw error;
  return toCheck(data as DbAnswer | null);
}

export type PromoRedeemed = PromoCheck & { trialExtended?: boolean; trialEndsAt?: string | null };

/**
 * One code for the account, before its first payment (promo_redeem locks the
 * code, so its limit holds). On success the partner's link cookie has done
 * its job and goes, and the redemption is recorded with the code as a keyed
 * hash only.
 */
export async function redeemPromo(
  userId: string,
  input: string,
  source: PromoSource,
  admin: Admin = createAdminClient(),
): Promise<PromoRedeemed> {
  const code = normalizePromoCode(input);
  if (!isPromoCode(code)) return { ok: false, problem: "invalid" };
  const { data, error } = await admin.rpc("promo_redeem", {
    _user_id: userId,
    _code: code,
    _source: source,
  });
  if (error) throw error;
  const answer = data as DbAnswer | null;
  const result = toCheck(answer);
  if (!result.ok) return result;
  await clearPromoCookie();
  await track(
    "promo_redeemed",
    {
      code_hash: fingerprint("promo", result.offer.code),
      source,
      benefit: result.offer.benefit,
      trial_extended: answer?.trial_extended === true,
    },
    { userId, admin },
  );
  return {
    ...result,
    trialExtended: answer?.trial_extended === true,
    trialEndsAt: answer?.trial_ends_at ?? null,
  };
}

export type PromoAccountStatus = {
  /** The code the account uses, with what it gave when it was entered. */
  redemption: (PromoOffer & { redeemedAt: string }) | null;
  /** Paid already: no code can be added any more. */
  paid: boolean;
};

export async function loadPromoAccountStatus(
  userId: string,
  admin: Admin = createAdminClient(),
): Promise<PromoAccountStatus> {
  const { data, error } = await admin.rpc("promo_account_status", { _user_id: userId });
  if (error) throw error;
  const row = (data ?? {}) as {
    redemption?: {
      code: string;
      benefit: string;
      benefit_value: number;
      redeemed_at: string;
    } | null;
    paid?: boolean;
  };
  const redemption =
    row.redemption && isBenefit(row.redemption.benefit)
      ? {
          code: row.redemption.code,
          benefit: row.redemption.benefit,
          value: Number(row.redemption.benefit_value),
          redeemedAt: row.redemption.redeemed_at,
        }
      : null;
  return { redemption, paid: row.paid === true };
}

/** The code a partner's link left in this browser (…/?kod=XYZ), if it looks like one. */
export async function promoFromCookie(): Promise<string | null> {
  const value = (await cookies()).get(PROMO_COOKIE)?.value ?? "";
  const code = normalizePromoCode(value);
  return isPromoCode(code) ? code : null;
}

async function clearPromoCookie() {
  try {
    const store = await cookies();
    if (store.get(PROMO_COOKIE)) store.delete(PROMO_COOKIE);
  } catch {
    // Outside a request that may set cookies (never in the app's flows): the cookie expires by itself.
  }
}
