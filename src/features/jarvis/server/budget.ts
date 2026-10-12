import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_PATH } from "@/features/admin/access";
import { serverTranslator } from "@/i18n/server-translator";
import { track } from "@/lib/analytics/track";
import { APP_NAME } from "@/lib/constants";
import { escapeHtml, sendEmail, type EmailResult } from "@/lib/email/resend";
import { DEFAULT_FORMAT_SETTINGS, formatNumber } from "@/lib/format";
import { siteOrigin } from "@/lib/site-origin";
import type { Database } from "@/types/database";
import { budgetSnapshot, monthlyBudgetUsd, utcMonthStart, type BudgetSnapshot } from "../budget";
import type { JarvisFeature } from "../models";
import { ownerContact } from "./owner";

type Client = SupabaseClient<Database>;

/** This month's spend of all accounts (internal ones too) against the budget. */
export async function loadBudget(admin: Client, now: Date = new Date()): Promise<BudgetSnapshot> {
  const { data, error } = await admin.rpc("jarvis_month_spend", {
    _since: utcMonthStart(now).toISOString(),
  });
  if (error) throw error;
  const row = data?.[0];
  return budgetSnapshot(
    { spentUsd: Number(row?.cost_usd ?? 0), calls: Number(row?.calls ?? 0) },
    monthlyBudgetUsd(process.env.JARVIS_MONTHLY_BUDGET_USD),
    now,
  );
}

export type AlertKind = "near_limit" | "paused";
export type PauseReason = { reason: "budget" } | { reason: "credits"; errorCode: string };

type Send = (message: Parameters<typeof sendEmail>[0]) => Promise<EmailResult>;

/**
 * One e-mail to the owner per day and kind: the row in jarvis_budget_alerts
 * is claimed first (a second call the same day finds it and sends nothing),
 * and given back when the e-mail fails, so a later call tries again.
 */
export async function alertOwner(
  admin: Client,
  kind: AlertKind,
  snapshot: BudgetSnapshot | null,
  pause: PauseReason | null,
  options: { now?: Date; send?: Send } = {},
): Promise<"sent" | "alreadySent" | "failed"> {
  const day = (options.now ?? new Date()).toISOString().slice(0, 10);
  const { data: claimed, error } = await admin
    .from("jarvis_budget_alerts")
    .upsert({ day, kind }, { onConflict: "day,kind", ignoreDuplicates: true })
    .select("day");
  if (error) {
    console.error("jarvis budget alert claim failed", error);
    return "failed";
  }
  if (!claimed?.length) return "alreadySent";

  const owner = await ownerContact(admin);
  const sent = owner.email
    ? await (options.send ?? sendEmail)({
        to: owner.email,
        ...(await alertEmail(kind, snapshot, pause, owner.locale)),
      })
    : ({ ok: false, error: "no owner e-mail" } as const);
  if (sent.ok) return "sent";
  console.error("jarvis budget e-mail failed", sent.error);
  await admin.from("jarvis_budget_alerts").delete().eq("day", day).eq("kind", kind);
  return "failed";
}

async function alertEmail(
  kind: AlertKind,
  snapshot: BudgetSnapshot | null,
  pause: PauseReason | null,
  locale: string | null,
) {
  const t = serverTranslator(locale);
  const usd = (value: number) =>
    formatNumber(
      value,
      { style: "currency", currency: "USD", decimals: 2 },
      DEFAULT_FORMAT_SETTINGS,
    );
  const percent = (value: number) =>
    formatNumber(value, { style: "percent" }, DEFAULT_FORMAT_SETTINGS);

  const lines: string[] = [
    kind === "near_limit"
      ? t("email.jarvisBudget.nearIntro", { appName: APP_NAME })
      : pause?.reason === "credits"
        ? t("email.jarvisBudget.creditsIntro", { appName: APP_NAME, code: pause.errorCode })
        : t("email.jarvisBudget.pausedIntro", { appName: APP_NAME }),
  ];
  if (snapshot) {
    lines.push(
      t("email.jarvisBudget.spent", {
        spent: usd(snapshot.spentUsd),
        budget: usd(snapshot.budgetUsd),
        share: percent(snapshot.share),
      }),
      t("email.jarvisBudget.projected", { projected: usd(snapshot.projectedUsd) }),
      t("email.jarvisBudget.calls", { calls: formatNumber(snapshot.calls) }),
    );
  }
  lines.push(t("email.jarvisBudget.appWorks", { appName: APP_NAME }));
  const origin = await siteOrigin().catch(() => null);
  if (origin) lines.push(t("email.jarvisBudget.details", { url: `${origin}${ADMIN_PATH}/ai` }));

  const subject =
    kind === "near_limit"
      ? t("email.jarvisBudget.nearSubject", {
          appName: APP_NAME,
          share: percent(snapshot?.share ?? 0),
        })
      : t("email.jarvisBudget.pausedSubject", { appName: APP_NAME });
  return {
    subject,
    text: lines.join("\n\n"),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n"),
  };
}

/** Before every model call, and when the API says the credit is gone. */
export type BudgetGuard = {
  /** False when Jarvis is paused: the budget is used up or the API ran out of credit. */
  allows(feature: JarvisFeature): Promise<boolean>;
  /** The API refused the call for lack of credit; no more calls through this guard. */
  creditsExhausted(feature: JarvisFeature, errorCode: string): Promise<void>;
};

/** A spend read this recently is reused, so a chat turn or a cron run does not sum ai_usage per call. */
const SNAPSHOT_TTL_MS = 15_000;

/**
 * The budget of one request or one cron run. Above 80 % the owner gets the
 * daily e-mail; at 100 % calls stop until the month ends. When the spend
 * cannot be read Jarvis keeps working (the error goes to the server log):
 * a broken read must not switch the assistant off.
 */
export function createBudgetGuard(
  admin: Client,
  options: { now?: () => Date; send?: Send } = {},
): BudgetGuard {
  const now = options.now ?? (() => new Date());
  let cached: { at: number; snapshot: BudgetSnapshot } | null = null;
  let creditsOut = false;
  const alerted = new Set<AlertKind>();

  const alertOnce = async (
    kind: AlertKind,
    snapshot: BudgetSnapshot | null,
    pause: PauseReason,
  ) => {
    if (alerted.has(kind)) return;
    alerted.add(kind);
    await alertOwner(admin, kind, snapshot, kind === "paused" ? pause : null, {
      now: now(),
      send: options.send,
    });
  };

  const paused = (feature: JarvisFeature, pause: PauseReason) =>
    track(
      "jarvis_paused",
      {
        feature,
        reason: pause.reason,
        ...(pause.reason === "credits" ? { error_code: pause.errorCode } : {}),
      },
      { userId: null, admin },
    );

  return {
    async allows(feature) {
      if (creditsOut) {
        await paused(feature, { reason: "credits", errorCode: "credits_exhausted" });
        return false;
      }
      const at = now().getTime();
      if (!cached || at - cached.at > SNAPSHOT_TTL_MS) {
        try {
          cached = { at, snapshot: await loadBudget(admin, now()) };
        } catch (error) {
          console.error("jarvis budget read failed", error);
          return true;
        }
      }
      const { snapshot } = cached;
      if (snapshot.status === "near") await alertOnce("near_limit", snapshot, { reason: "budget" });
      if (snapshot.status !== "paused") return true;
      await alertOnce("paused", snapshot, { reason: "budget" });
      await paused(feature, { reason: "budget" });
      return false;
    },
    async creditsExhausted(feature, errorCode) {
      creditsOut = true;
      await paused(feature, { reason: "credits", errorCode });
      await alertOnce("paused", cached?.snapshot ?? null, { reason: "credits", errorCode });
    },
  };
}
