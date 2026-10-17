/**
 * The AI usage caps set in the administration (app_settings 'ai_caps' and
 * ai_user_caps). Pure: what the stored values mean, their defaults, the
 * limits of the form and which cap applies to one user. The database reads
 * are in server/caps.ts, the check before every model call in server/budget.ts.
 */
import { z } from "zod";
import { monthlyBudgetUsd, NEAR_LIMIT_SHARE } from "./budget";

/** The most the application-wide monthly cap may be set to, in USD. */
export const MAX_MONTHLY_USD = 10_000;
/** The most one user's monthly cap (application-wide or an exception) may be, in USD. */
export const MAX_USER_USD = 1_000;
export const DEFAULT_WARN_PERCENT = Math.round(NEAR_LIMIT_SHARE * 100);

/** The caps in force, defaults filled in. */
export type AiCaps = {
  /** Every account together, this calendar month (UTC). 0 = no model calls. */
  monthlyUsd: number;
  /** One user this month; null = no per-user limit. */
  perUserUsd: number | null;
  /** From this share of monthlyUsd the owner gets one e-mail a day (0.01–1). */
  warnShare: number;
  /** Whether the values come from the database or from the defaults. */
  source: "database" | "default";
};

/** The stored 'ai_caps' value; the database checks the same limits (valid_ai_caps). */
export const storedAiCapsSchema = z
  .object({
    monthly_usd: z.number().min(0).max(MAX_MONTHLY_USD),
    per_user_usd: z.number().gt(0).max(MAX_USER_USD).nullable(),
    warn_percent: z.number().int().min(1).max(100),
  })
  .strict();
export type StoredAiCaps = z.infer<typeof storedAiCapsSchema>;

/**
 * The caps from the stored value, or the defaults when there is none (or it
 * is unreadable): JARVIS_MONTHLY_BUDGET_USD, no per-user limit, 80 %.
 */
export function resolveAiCaps(stored: unknown, envBudget: string | undefined): AiCaps {
  const parsed = storedAiCapsSchema.safeParse(stored);
  if (!parsed.success) {
    return {
      monthlyUsd: monthlyBudgetUsd(envBudget),
      perUserUsd: null,
      warnShare: NEAR_LIMIT_SHARE,
      source: "default",
    };
  }
  return {
    monthlyUsd: parsed.data.monthly_usd,
    perUserUsd: parsed.data.per_user_usd,
    warnShare: parsed.data.warn_percent / 100,
    source: "database",
  };
}

/** An exception for one user (a row in ai_user_caps), or null. */
export type UserCapOverride = { capUsd: number | null; blocked: boolean } | null;

/** What limits one user this month. */
export type UserLimit =
  | { kind: "blocked" }
  | { kind: "cap"; usd: number; source: "override" | "global" }
  | { kind: "none" };

export function userLimit(caps: Pick<AiCaps, "perUserUsd">, override: UserCapOverride): UserLimit {
  if (override?.blocked) return { kind: "blocked" };
  if (override?.capUsd != null) return { kind: "cap", usd: override.capUsd, source: "override" };
  if (caps.perUserUsd != null) return { kind: "cap", usd: caps.perUserUsd, source: "global" };
  return { kind: "none" };
}

/** Whether this user may call the model now; the application-wide cap is checked separately. */
export function userAllowed(limit: UserLimit, spentUsd: number): boolean {
  if (limit.kind === "blocked") return false;
  if (limit.kind === "cap") return spentUsd < limit.usd;
  return true;
}

/** What is left under a cap this month, never below zero. */
export function remainingUsd(capUsd: number, spentUsd: number): number {
  return Math.max(0, capUsd - spentUsd);
}

// ---------------------------------------------------------------------------
// The administration's forms
// ---------------------------------------------------------------------------

/** A money amount typed in a form: "12", "12.5" or "12,5"; empty = null. */
const amount = z
  .union([z.string(), z.number(), z.null()])
  .transform((value, ctx) => {
    if (value === null) return null;
    const text = String(value).trim().replace(",", ".");
    if (text === "") return null;
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      ctx.addIssue({ code: "custom", message: "amount" });
      return z.NEVER;
    }
    return Number(text);
  });

/** The application-wide caps as the form sends them. */
export const aiCapsFormSchema = z.object({
  monthlyUsd: amount.pipe(z.number().min(0).max(MAX_MONTHLY_USD)),
  perUserUsd: amount.pipe(z.number().gt(0).max(MAX_USER_USD).nullable()),
  warnPercent: z.coerce.number().int().min(1).max(100),
});
export type AiCapsForm = z.input<typeof aiCapsFormSchema>;

export function toStoredAiCaps(form: z.output<typeof aiCapsFormSchema>): StoredAiCaps {
  return {
    monthly_usd: form.monthlyUsd,
    per_user_usd: form.perUserUsd,
    warn_percent: form.warnPercent,
  };
}

export const USER_CAP_MODES = ["default", "cap", "blocked"] as const;
export type UserCapMode = (typeof USER_CAP_MODES)[number];

/** One user's exception as the form sends it. */
export const userCapFormSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("default") }),
  z.object({ mode: z.literal("blocked") }),
  z.object({ mode: z.literal("cap"), capUsd: amount.pipe(z.number().gt(0).max(MAX_USER_USD)) }),
]);
export type UserCapForm = z.input<typeof userCapFormSchema>;

export function userCapModeOf(override: UserCapOverride): UserCapMode {
  if (override?.blocked) return "blocked";
  if (override?.capUsd != null) return "cap";
  return "default";
}
