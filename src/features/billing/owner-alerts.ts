import { formatDateTime, formatNumber, type FormatSettings } from "@/lib/format";

/**
 * The app owner's digest of payments (step 23.2): the first payment of an
 * account and a subscription Stripe ended after its last failed attempt, in
 * one e-mail a day at most (billing_alerts_claim() decides when). Pure, so
 * the text is tested without Resend or the database.
 */

export type OwnerAlertKind = "first_payment" | "final_failure";

export type OwnerAlertRow = {
  id: string;
  kind: OwnerAlertKind;
  userId: string;
  mode: "test" | "live";
  planKey: string | null;
  billing: "monthly" | "yearly" | null;
  amount: number | null;
  currency: string | null;
  createdAt: string;
};

type Translate = (key: string, values?: Record<string, string | number>) => string;

export type DigestInput = {
  alerts: readonly OwnerAlertRow[];
  /** The account's e-mail (or name) by id; the id when unknown. */
  who: (userId: string) => string;
  planName: (key: string) => string;
  /** The administration's account page, or null without a site address. */
  adminUrl: (userId: string) => string | null;
  t: Translate;
  settings: FormatSettings;
  appName: string;
};

export type DigestMail = { subject: string; lines: string[] };

/** The subject and the lines; first payments first, then the ended subscriptions, oldest first. */
export function ownerDigest(input: DigestInput): DigestMail | null {
  const { alerts, t, settings } = input;
  if (alerts.length === 0) return null;
  const sorted = [...alerts].sort(
    (a, b) => (a.kind === b.kind ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : a.kind === "first_payment" ? -1 : 1),
  );
  const firsts = sorted.filter((alert) => alert.kind === "first_payment");
  const failures = sorted.filter((alert) => alert.kind === "final_failure");

  const line = (alert: OwnerAlertRow) => {
    const parts = [input.who(alert.userId)];
    if (alert.planKey) {
      parts.push(
        alert.billing
          ? `${input.planName(alert.planKey)} · ${t(`billing.ownerDigest.billing.${alert.billing}`)}`
          : input.planName(alert.planKey),
      );
    }
    if (alert.kind === "first_payment" && alert.amount !== null && alert.currency) {
      parts.push(formatNumber(alert.amount, { style: "currency", currency: alert.currency }, settings));
    }
    parts.push(formatDateTime(new Date(alert.createdAt), settings));
    if (alert.mode === "test") parts.push(t("billing.ownerDigest.testMode"));
    const url = input.adminUrl(alert.userId);
    return `- ${parts.join(" · ")}${url ? `\n  ${url}` : ""}`;
  };

  const lines: string[] = [t("billing.ownerDigest.intro")];
  if (firsts.length) {
    lines.push("", t("billing.ownerDigest.firstPayments", { count: firsts.length }), ...firsts.map(line));
  }
  if (failures.length) {
    lines.push(
      "",
      t("billing.ownerDigest.finalFailures", { count: failures.length }),
      t("billing.ownerDigest.finalFailuresHint"),
      ...failures.map(line),
    );
  }
  return {
    subject: t("billing.ownerDigest.subject", {
      appName: input.appName,
      firsts: firsts.length,
      failures: failures.length,
    }),
    lines,
  };
}
