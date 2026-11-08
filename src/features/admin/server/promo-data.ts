import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PROMO_BENEFITS,
  PROMO_KINDS,
  PROMO_SOURCES,
  type PromoBenefitKind,
  type PromoKind,
  type PromoSource,
} from "@/features/promo/codes";
import { moneyMap, type PayoutExportRow, type PromoCodeStats } from "../promo-admin";

/**
 * The administration's promo codes, read with the admin client after the
 * guard (the tables are closed to every client). Only for the pages and the
 * export of /admin/promo-kody; nothing here is passed to analytics.
 */

/** More codes than a partner programme of a young app will ever have; the list is not paged. */
const CODES_LIMIT = 500;
export const USERS_PAGE = 50;
const PAYOUTS_LIMIT = 500;
const DAY = 86_400_000;

export type PromoCodeRow = {
  id: string;
  code: string;
  partnerName: string;
  partnerEmail: string | null;
  partnerNote: string | null;
  kind: PromoKind;
  benefit: PromoBenefitKind;
  benefitValue: number;
  commissionPercent: number;
  maxUses: number | null;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  createdAt: string;
};

const CODE_COLUMNS =
  "id, code, partner_name, partner_email, partner_note, kind, benefit, benefit_value, commission_percent_first, max_uses, valid_from, valid_to, active, created_at";

type CodeDbRow = {
  id: string;
  code: string;
  partner_name: string;
  partner_email: string | null;
  partner_note: string | null;
  kind: string;
  benefit: string;
  benefit_value: number;
  commission_percent_first: number;
  max_uses: number | null;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
  created_at: string;
};

const oneOf = <T extends string>(values: readonly T[], value: string, fallback: T): T =>
  (values as readonly string[]).includes(value) ? (value as T) : fallback;

function toCode(row: CodeDbRow): PromoCodeRow {
  return {
    id: row.id,
    code: row.code,
    partnerName: row.partner_name,
    partnerEmail: row.partner_email,
    partnerNote: row.partner_note,
    kind: oneOf(PROMO_KINDS, row.kind, "partner"),
    benefit: oneOf(PROMO_BENEFITS, row.benefit, "percent_off_first"),
    benefitValue: row.benefit_value,
    commissionPercent: Number(row.commission_percent_first),
    maxUses: row.max_uses,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    active: row.active,
    createdAt: row.created_at,
  };
}

const emptyStats = (codeId: string): PromoCodeStats => ({
  codeId,
  redemptions: 0,
  redemptionsSince: 0,
  paying: 0,
  payingSince: 0,
  due: {},
  paid: {},
});

export type PromoCodeWithStats = PromoCodeRow & { stats: PromoCodeStats };

/** Every code, newest first, with its figures overall and for the last 30 days. */
export async function loadPromoCodes(now: Date = new Date()): Promise<PromoCodeWithStats[]> {
  const admin = createAdminClient();
  const [codes, stats] = await Promise.all([
    admin
      .from("promo_codes")
      .select(CODE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(CODES_LIMIT),
    admin.rpc("admin_promo_code_stats", {
      _since: new Date(now.getTime() - 30 * DAY).toISOString(),
    }),
  ]);
  if (codes.error) throw new Error(`promo_codes: ${codes.error.message}`);
  if (stats.error) throw new Error(`admin_promo_code_stats: ${stats.error.message}`);
  const byCode = new Map<string, PromoCodeStats>(
    (stats.data ?? []).map((row) => [
      row.code_id,
      {
        codeId: row.code_id,
        redemptions: row.redemptions,
        redemptionsSince: row.redemptions_since,
        paying: row.paying,
        payingSince: row.paying_since,
        due: moneyMap(row.payouts_due),
        paid: moneyMap(row.payouts_paid),
      },
    ]),
  );
  return (codes.data as CodeDbRow[]).map((row) => ({
    ...toCode(row),
    stats: byCode.get(row.id) ?? emptyStats(row.id),
  }));
}

export async function loadPromoCode(id: string): Promise<PromoCodeWithStats | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("promo_codes")
    .select(CODE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`promo_codes: ${error.message}`);
  if (!data) return null;
  const all = await admin.rpc("admin_promo_code_stats", {
    _since: new Date(Date.now() - 30 * DAY).toISOString(),
  });
  if (all.error) throw new Error(`admin_promo_code_stats: ${all.error.message}`);
  const row = (all.data ?? []).find((stat) => stat.code_id === id);
  return {
    ...toCode(data as CodeDbRow),
    stats: row
      ? {
          codeId: id,
          redemptions: row.redemptions,
          redemptionsSince: row.redemptions_since,
          paying: row.paying,
          payingSince: row.paying_since,
          due: moneyMap(row.payouts_due),
          paid: moneyMap(row.payouts_paid),
        }
      : emptyStats(id),
  };
}

export type PromoCodeUser = {
  userId: string;
  redeemedAt: string;
  source: PromoSource;
  firstPaidAt: string | null;
  isInternal: boolean;
};

/** The accounts that used a code, newest first, a page at a time. */
export async function loadPromoCodeUsers(
  codeId: string,
  page: number,
): Promise<{ users: PromoCodeUser[]; total: number }> {
  const { data, error } = await createAdminClient().rpc("admin_promo_code_users", {
    _code_id: codeId,
    _limit: USERS_PAGE,
    _offset: Math.max(0, page) * USERS_PAGE,
  });
  if (error) throw new Error(`admin_promo_code_users: ${error.message}`);
  const rows = data ?? [];
  return {
    total: rows.length ? Number(rows[0].total) : 0,
    users: rows.map((row) => ({
      userId: row.user_id,
      redeemedAt: row.redeemed_at,
      source: oneOf(PROMO_SOURCES, row.source, "signup"),
      firstPaidAt: row.first_paid_at ?? null,
      isInternal: row.is_internal,
    })),
  };
}

export type PayoutStatus = "pending" | "approved" | "paid";
export type PromoPayout = PayoutExportRow & { userId: string | null; status: PayoutStatus };

/** The payouts of a code, newest first. */
export async function loadPromoPayouts(codeId: string): Promise<PromoPayout[]> {
  const { data, error } = await createAdminClient()
    .from("partner_payouts")
    .select(
      "id, user_id, base_amount, commission_percent, amount, currency, status, approved_at, paid_at, created_at",
    )
    .eq("code_id", codeId)
    .order("created_at", { ascending: false })
    .limit(PAYOUTS_LIMIT);
  if (error) throw new Error(`partner_payouts: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    status: oneOf(["pending", "approved", "paid"] as const, row.status, "pending"),
    baseAmount: Number(row.base_amount),
    commissionPercent: Number(row.commission_percent),
    amount: Number(row.amount),
    currency: row.currency,
    approvedAt: row.approved_at,
    paidAt: row.paid_at,
  }));
}
