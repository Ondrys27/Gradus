import {
  instantToZonedParts,
  zonedWallClockToInstant,
  formatCsvDecimal,
  type IsoDate,
} from "@/lib/format";
import { toCsv } from "./access";

/**
 * The administration's promo codes (step 22.2), without React: the days a
 * code is valid as stored instants, the best codes of the last 30 days, and
 * the payouts as CSV for the accountant.
 */

/** "Valid from" a day: from its first minute in the administration's zone. */
export function validFromInstant(day: string, timeZone: string): string | null {
  if (!day) return null;
  return zonedWallClockToInstant(day as IsoDate, "00:00", timeZone).toISOString();
}

/** "Valid to" a day: the whole day, so until the first minute of the next one. */
export function validToInstant(day: string, timeZone: string): string | null {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return zonedWallClockToInstant(next, "00:00", timeZone).toISOString();
}

/** The day a stored "valid from" shows in the form. */
export function validFromDay(instant: string | null, timeZone: string): string {
  return instant ? instantToZonedParts(new Date(instant), timeZone).date : "";
}

/** The last valid day of a stored "valid to" (the instant is the next day's start). */
export function validToDay(instant: string | null, timeZone: string): string {
  return instant ? instantToZonedParts(new Date(Date.parse(instant) - 60_000), timeZone).date : "";
}

export type PromoCodeStats = {
  codeId: string;
  redemptions: number;
  redemptionsSince: number;
  paying: number;
  payingSince: number;
  /** Commissions pending or approved, per currency (never summed across). */
  due: Record<string, number>;
  paid: Record<string, number>;
};

/** The codes with registrations in the last 30 days: most registrations first, then most paying. */
export function bestCodes<T extends { stats: PromoCodeStats }>(
  codes: readonly T[],
  limit = 5,
): T[] {
  return codes
    .filter((code) => code.stats.redemptionsSince > 0 || code.stats.payingSince > 0)
    .sort(
      (a, b) =>
        b.stats.redemptionsSince - a.stats.redemptionsSince ||
        b.stats.payingSince - a.stats.payingSince,
    )
    .slice(0, limit);
}

/** Money per currency from the database's JSON, positive amounts only. */
export function moneyMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [currency, amount] of Object.entries(value as Record<string, unknown>)) {
    const number = Number(amount);
    if (/^[A-Z]{3}$/.test(currency) && Number.isFinite(number) && number > 0)
      out[currency] = number;
  }
  return out;
}

export const PAYOUTS_EXPORT_HEADER = [
  "payout_id",
  "code",
  "partner_name",
  "partner_email",
  "created_at",
  "status",
  "payment_without_vat",
  "commission_percent",
  "commission",
  "currency",
  "approved_at",
  "paid_at",
] as const;

export type PayoutExportRow = {
  id: string;
  createdAt: string;
  status: string;
  baseAmount: number;
  commissionPercent: number;
  amount: number;
  currency: string;
  approvedAt: string | null;
  paidAt: string | null;
};

/**
 * The payouts of one code for the accountant: who is paid (the partner),
 * what and when. No account of the paying user: the accountant pays the
 * partner, the payment row is enough.
 */
export function payoutsCsv(
  code: { code: string; partnerName: string; partnerEmail: string | null },
  rows: readonly PayoutExportRow[],
): string {
  return toCsv(
    PAYOUTS_EXPORT_HEADER,
    rows.map((row) => [
      row.id,
      code.code,
      code.partnerName,
      code.partnerEmail,
      row.createdAt,
      row.status,
      formatCsvDecimal(row.baseAmount, 2),
      formatCsvDecimal(row.commissionPercent, 2),
      formatCsvDecimal(row.amount, 2),
      row.currency,
      row.approvedAt,
      row.paidAt,
    ]),
  );
}
