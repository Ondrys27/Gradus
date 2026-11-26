import { RESEND_PLANS, type ResendPlan } from "@/lib/email/kinds";

/**
 * The E-mails widget (30.1) without I/O: e-mails today and this month
 * against Resend's plan, and when the month's limit runs out at the pace of
 * the month so far. Counted from email_log (admin_email_usage).
 */

export type EmailUsage = {
  today: number;
  month: number;
  failedMonth: number;
  byKind: Record<string, number>;
};

export type EmailForecast = {
  monthlyLimit: number;
  dailyLimit: number | null;
  /** At this month's pace, how many by its end. */
  projected: number;
  /** The day of the month the limit is reached at that pace; null when it lasts the month. */
  exhaustDay: number | null;
  /** Share of the month's limit used, 0–1 (and above when over). */
  monthShare: number;
  /** Share of the day's limit used (free plan only). */
  dayShare: number | null;
};

/** Days of the month so far count whole: the 1st at noon is day 1. */
export function emailForecast(
  usage: Pick<EmailUsage, "today" | "month">,
  dayOfMonth: number,
  daysInMonth: number,
  plan: ResendPlan,
): EmailForecast {
  const { monthly, daily } = RESEND_PLANS[plan];
  const elapsed = Math.max(1, Math.min(dayOfMonth, daysInMonth));
  const perDay = usage.month / elapsed;
  const projected = Math.round(perDay * daysInMonth);
  let exhaustDay: number | null = null;
  if (usage.month >= monthly) exhaustDay = elapsed;
  else if (perDay > 0) {
    const day = Math.ceil(monthly / perDay);
    exhaustDay = day <= daysInMonth ? day : null;
  }
  return {
    monthlyLimit: monthly,
    dailyLimit: daily,
    projected,
    exhaustDay,
    monthShare: usage.month / monthly,
    dayShare: daily ? usage.today / daily : null,
  };
}

export type UsageState = "good" | "warn" | "bad";

/** Calm below 80 % of a limit, a warning from there, red at the limit. */
export function usageState(share: number | null): UsageState {
  if (share === null) return "good";
  return share >= 1 ? "bad" : share >= 0.8 ? "warn" : "good";
}

/** The stored answer of admin_email_usage, read defensively. */
export function parseEmailUsage(value: unknown): EmailUsage {
  const record = (value ?? {}) as Record<string, unknown>;
  const count = (raw: unknown) => {
    const number = Number(raw);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
  };
  const byKind: Record<string, number> = {};
  if (record.by_kind && typeof record.by_kind === "object") {
    for (const [kind, n] of Object.entries(record.by_kind as Record<string, unknown>)) {
      if (count(n) > 0) byKind[kind] = count(n);
    }
  }
  return {
    today: count(record.today),
    month: count(record.month),
    failedMonth: count(record.failed_month),
    byKind,
  };
}
