import { z } from "zod";

/**
 * Promo codes of partners (step 22.2): what a code looks like, what it may
 * give and what the partner earns. The database checks the same in
 * 20261108120000_promo_codes.sql (the code's pattern, the benefit's range,
 * the commission); this mirrors it for the forms, and computes the
 * commission the same way as payments_promo_payout().
 */

export {
  isPromoCode,
  normalizePromoCode,
  promoCodeFromParam,
  PROMO_CODE_MAX,
  PROMO_CODE_MIN,
  PROMO_CODE_PATTERN,
  PROMO_COOKIE,
  PROMO_COOKIE_MAX_AGE,
  PROMO_PARAM,
} from "./link";
import { isPromoCode, normalizePromoCode, PROMO_PARAM } from "./link";

export const PROMO_KINDS = ["influencer", "partner", "campaign"] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export const PROMO_BENEFITS = ["trial_days_extra", "percent_off_first", "months_free"] as const;
export type PromoBenefitKind = (typeof PROMO_BENEFITS)[number];

/** Where an account entered its code. A gateway's checkout will use `checkout`. */
export const PROMO_SOURCES = ["signup", "checkout", "settings"] as const;
export type PromoSource = (typeof PROMO_SOURCES)[number];

export const BENEFIT_LIMITS: Record<PromoBenefitKind, { min: number; max: number }> = {
  trial_days_extra: { min: 1, max: 90 },
  percent_off_first: { min: 1, max: 100 },
  months_free: { min: 1, max: 12 },
};

export type PromoBenefit = { benefit: PromoBenefitKind; value: number };

export const PARTNER_NAME_MAX = 120;
export const PARTNER_NOTE_MAX = 1000;
export const MAX_USES_LIMIT = 1_000_000;

/** Why a code cannot be used, as promo_check() and promo_redeem() answer. */
export const PROMO_PROBLEMS = [
  "invalid",
  "not_found",
  "inactive",
  "not_started",
  "expired",
  "exhausted",
  "already_redeemed",
  "already_paid",
  "no_trial",
] as const;
export type PromoProblem = (typeof PROMO_PROBLEMS)[number];

/** Letters and digits nobody mixes up when reading a code aloud (no 0/O, 1/I/L). */
export const GENERATED_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const GENERATED_LENGTH = 8;

/** A random code for the administration's generator. */
export function generatePromoCode(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
  length: number = GENERATED_LENGTH,
): string {
  const size = GENERATED_ALPHABET.length;
  // Bytes at or above the largest multiple of the alphabet would favour its start.
  const limit = 256 - (256 % size);
  let out = "";
  while (out.length < length) {
    for (const byte of random(new Uint8Array(length * 2))) {
      if (byte < limit && out.length < length) out += GENERATED_ALPHABET[byte % size];
    }
  }
  return out;
}

const toCents = (amount: number) => Math.round(amount * 100);

/**
 * The partner's commission on the first payment: `percent` of the payment
 * without VAT, rounded to the cent (half up), as payments_promo_payout().
 * Negative or empty amounts earn nothing.
 */
export function partnerCommission(amount: number, vatAmount: number, percent: number): number {
  const net = toCents(amount) - toCents(vatAmount);
  if (net <= 0 || percent <= 0) return 0;
  // The percentage has at most two decimals; whole numbers keep the rounding exact.
  const hundredths = Math.round(Math.min(percent, 100) * 100);
  return Math.round((net * hundredths) / 10_000) / 100;
}

// ---------------------------------------------------------------------------
// The administration's form
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null);

/** Dates are calendar days in the administration's zone; empty = without a limit. */
const optionalDay = z.union([z.literal(""), z.iso.date()]);

export const promoCodeFormSchema = z
  .object({
    code: z.string().transform(normalizePromoCode).refine(isPromoCode, "code"),
    partnerName: z.string().trim().min(1, "partnerName").max(PARTNER_NAME_MAX, "partnerName"),
    partnerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "partnerEmail")
      .refine((value) => value === "" || z.email().safeParse(value).success, "partnerEmail")
      .transform((value) => value || null),
    partnerNote: optionalText(PARTNER_NOTE_MAX),
    kind: z.enum(PROMO_KINDS),
    benefit: z.enum(PROMO_BENEFITS),
    benefitValue: z.number().int("benefitValue"),
    commissionPercent: z
      .number()
      .min(0, "commission")
      .max(100, "commission")
      .refine((value) => Number.isInteger(Math.round(value * 100 * 1e6) / 1e6), "commission"),
    maxUses: z.number().int("maxUses").min(1, "maxUses").max(MAX_USES_LIMIT, "maxUses").nullable(),
    validFrom: optionalDay,
    validTo: optionalDay,
    active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const { min, max } = BENEFIT_LIMITS[value.benefit];
    if (value.benefitValue < min || value.benefitValue > max) {
      ctx.addIssue({ code: "custom", path: ["benefitValue"], message: "benefitValue" });
    }
    if (value.validFrom && value.validTo && value.validTo < value.validFrom) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "validTo" });
    }
  });

export type PromoCodeFormInput = z.input<typeof promoCodeFormSchema>;
export type PromoCodeForm = z.output<typeof promoCodeFormSchema>;

/** The form's fields that can carry an error, by the message zod gives. */
export type PromoFormError =
  "code" | "partnerName" | "partnerEmail" | "benefitValue" | "commission" | "maxUses" | "validTo";

export function promoFormErrors(error: z.ZodError): PromoFormError[] {
  const known: readonly string[] = [
    "code",
    "partnerName",
    "partnerEmail",
    "benefitValue",
    "commission",
    "maxUses",
    "validTo",
  ];
  const out = new Set<PromoFormError>();
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    const key = field === "commissionPercent" ? "commission" : field;
    if (known.includes(key)) out.add(key as PromoFormError);
  }
  return [...out];
}

/** The link a partner shares: the website with the code, which the visit keeps for 30 days. */
export function promoLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/?${PROMO_PARAM}=${encodeURIComponent(code)}`;
}

// ---------------------------------------------------------------------------
// The list's state of a code
// ---------------------------------------------------------------------------

export type PromoCodeState = "active" | "inactive" | "scheduled" | "expired" | "exhausted";

/** What the administration's list says about a code now, as promo_code_state() decides. */
export function promoCodeState(
  code: {
    active: boolean;
    validFrom: string | null;
    validTo: string | null;
    maxUses: number | null;
  },
  redemptions: number,
  now: Date = new Date(),
): PromoCodeState {
  if (!code.active) return "inactive";
  if (code.validFrom && Date.parse(code.validFrom) > now.getTime()) return "scheduled";
  if (code.validTo && Date.parse(code.validTo) <= now.getTime()) return "expired";
  if (code.maxUses !== null && redemptions >= code.maxUses) return "exhausted";
  return "active";
}
