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
import { budgetSnapshot, NEAR_LIMIT_SHARE, utcMonthStart, type BudgetSnapshot } from "../budget";
import { userAllowed, userInEconomy, userLimit, type AiCaps } from "../caps";
import type { EconomyReason } from "../model-settings";
import type { GradyFeature } from "../models";
import { loadAiCaps, loadSpaceSpend, loadUserOverride, loadUserSpend } from "./caps";
import { ownerContact } from "./owner";

type Client = SupabaseClient<Database>;

/**
 * This month's spend of all accounts (internal ones too) against the
 * application-wide cap and warning threshold set in the administration
 * (GRADY_MONTHLY_BUDGET_USD and 80 % while none is set).
 */
export async function loadBudget(
  admin: Client,
  now: Date = new Date(),
  caps?: AiCaps,
): Promise<BudgetSnapshot> {
  const [inForce, { data, error }] = await Promise.all([
    caps ?? loadAiCaps(admin, { now: now.getTime() }),
    admin.rpc("jarvis_month_spend", { _since: utcMonthStart(now).toISOString() }),
  ]);
  if (error) throw error;
  const row = data?.[0];
  return budgetSnapshot(
    { spentUsd: Number(row?.cost_usd ?? 0), calls: Number(row?.calls ?? 0) },
    inForce.monthlyUsd,
    now,
    inForce.warnShare,
  );
}

/**
 * near_limit: the daily e-mail above the warning threshold; economy: the one
 * e-mail of the month when Grady switched to economy mode at that threshold
 * (claimed on the first day of the UTC month); paused: at 100 % or without
 * credit.
 */
export type AlertKind = "near_limit" | "economy" | "paused";
export type PauseReason = { reason: "budget" } | { reason: "credits"; errorCode: string };

type Send = (message: Parameters<typeof sendEmail>[0]) => Promise<EmailResult>;

/**
 * Claims the row of one e-mail (day, kind): true when this call is the first,
 * false when it was already claimed or the claim failed (logged).
 */
async function claimAlert(admin: Client, day: string, kind: AlertKind): Promise<boolean> {
  const { data: claimed, error } = await admin
    .from("jarvis_budget_alerts")
    .upsert({ day, kind }, { onConflict: "day,kind", ignoreDuplicates: true })
    .select("day");
  if (error) {
    console.error("grady budget alert claim failed", error);
    return false;
  }
  return !!claimed?.length;
}

/**
 * One e-mail to the owner per day and kind (economy: per month, `day` = the
 * first day of the UTC month): the row in jarvis_budget_alerts is claimed
 * first (a second call finds it and sends nothing), and given back when the
 * e-mail fails, so a later call tries again.
 */
export async function alertOwner(
  admin: Client,
  kind: AlertKind,
  snapshot: BudgetSnapshot | null,
  pause: PauseReason | null,
  options: { now?: Date; send?: Send; day?: string } = {},
): Promise<"sent" | "alreadySent" | "failed"> {
  const now = options.now ?? new Date();
  const day =
    options.day ??
    (kind === "economy" ? utcMonthStart(now) : now).toISOString().slice(0, 10);
  const { data: claimed, error } = await admin
    .from("jarvis_budget_alerts")
    .upsert({ day, kind }, { onConflict: "day,kind", ignoreDuplicates: true })
    .select("day");
  if (error) {
    console.error("grady budget alert claim failed", error);
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
  console.error("grady budget e-mail failed", sent.error);
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

  const threshold = percent(snapshot?.warnShare ?? NEAR_LIMIT_SHARE);
  const lines: string[] = [
    kind === "economy"
      ? t("email.gradyBudget.economyIntro", { appName: APP_NAME, threshold })
      : kind === "near_limit"
      ? t("email.gradyBudget.nearIntro", { appName: APP_NAME, threshold })
      : pause?.reason === "credits"
        ? t("email.gradyBudget.creditsIntro", { appName: APP_NAME, code: pause.errorCode })
        : t("email.gradyBudget.pausedIntro", { appName: APP_NAME }),
  ];
  if (snapshot) {
    lines.push(
      t("email.gradyBudget.spent", {
        spent: usd(snapshot.spentUsd),
        budget: usd(snapshot.budgetUsd),
        share: percent(snapshot.share),
      }),
      t("email.gradyBudget.projected", { projected: usd(snapshot.projectedUsd) }),
      t("email.gradyBudget.calls", { calls: formatNumber(snapshot.calls) }),
    );
  }
  lines.push(
    t(kind === "economy" ? "email.gradyBudget.economyOnce" : "email.gradyBudget.appWorks", {
      appName: APP_NAME,
    }),
  );
  const origin = await siteOrigin().catch(() => null);
  if (origin) lines.push(t("email.gradyBudget.details", { url: `${origin}${ADMIN_PATH}/ai` }));

  const subject =
    kind === "economy"
      ? t("email.gradyBudget.economySubject", {
          appName: APP_NAME,
          share: percent(snapshot?.share ?? 0),
        })
      : kind === "near_limit"
      ? t("email.gradyBudget.nearSubject", {
          appName: APP_NAME,
          share: percent(snapshot?.share ?? 0),
        })
      : t("email.gradyBudget.pausedSubject", { appName: APP_NAME });
  return {
    subject,
    text: lines.join("\n\n"),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n"),
  };
}

/**
 * What the check before a model call decided: go ahead; "paused" — the
 * application-wide cap is used up or the API ran out of credit (Grady takes
 * a break until the month ends); "userLimit" — this user's own monthly cap is
 * used up or AI is blocked for them (the rest of the app works on);
 * "spaceLimit" — the company the user works in has used up its cap (its
 * owner's cap covers every call made there, the owner pays for them).
 */
export type BudgetVerdict = "ok" | "paused" | "userLimit" | "spaceLimit";

/**
 * The check before a model call with the economy mode it found: from the
 * warning threshold of a cap on (the application's monthly cap, this user's
 * own, the company's), every job runs on its minimum model until the month
 * ends; null = no economy from the budget (the switch in the administration
 * is read with the model settings).
 */
export type BudgetAssessment = { verdict: BudgetVerdict; economy: EconomyReason | null };

/** Before every model call, and when the API says the credit is gone. */
export type BudgetGuard = {
  /** check() with the economy mode the caps call for. */
  assess(feature: GradyFeature, userId?: string | null): Promise<BudgetAssessment>;
  /**
   * The application-wide cap always; with a user id also that user's cap
   * (an exception from ai_user_caps, else the per-user cap of the app) on
   * everything they spent, and the cap of the space the call is made in (its
   * owner's cap) on everything spent there by anybody.
   */
  check(feature: GradyFeature, userId?: string | null): Promise<BudgetVerdict>;
  /** The API refused the call for lack of credit; no more calls through this guard. */
  creditsExhausted(feature: GradyFeature, errorCode: string): Promise<void>;
};

/** A spend read this recently is reused, so a chat turn or a cron run does not sum ai_usage per call. */
const SNAPSHOT_TTL_MS = 15_000;

type PausedReason =
  | PauseReason
  | { reason: "user_cap" }
  | { reason: "user_blocked" }
  | { reason: "space_cap" };

/**
 * The budget of one request or one cron run. The caps come from the
 * administration (cached for at most CAPS_TTL_MS, so a change applies within
 * a minute). From the warning threshold the owner gets the daily e-mail; at
 * 100 % calls stop until the month ends. A user at their own cap gets no model
 * call either, without any e-mail. When the spend cannot be read Grady keeps
 * working (the error goes to the server log): a broken read must not switch
 * the assistant off.
 */
export function createBudgetGuard(
  admin: Client,
  options: {
    now?: () => Date;
    send?: Send;
    /** The space this request works in; the user's own one when not given. */
    spaceId?: string | null;
  } = {},
): BudgetGuard {
  const now = options.now ?? (() => new Date());
  let cached: { at: number; snapshot: BudgetSnapshot } | null = null;
  const userSpend = new Map<string, { at: number; spentUsd: number }>();
  const spaceSpend = new Map<string, { at: number; spentUsd: number }>();
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

  const paused = (feature: GradyFeature, pause: PausedReason, userId: string | null = null) =>
    track(
      "jarvis_paused",
      {
        feature,
        reason: pause.reason,
        ...(pause.reason === "credits" ? { error_code: pause.errorCode } : {}),
      },
      { userId, admin },
    );

  /**
   * The month's first crossing of the threshold sends "Grady switched to
   * economy mode" once; that day's daily e-mail is then taken as sent. Other
   * days bring the daily e-mail as before.
   */
  const alertNear = async (snapshot: BudgetSnapshot) => {
    if (!alerted.has("economy")) {
      alerted.add("economy");
      const economy = await alertOwner(admin, "economy", snapshot, null, {
        now: now(),
        send: options.send,
      });
      if (economy === "sent") {
        alerted.add("near_limit");
        await claimAlert(admin, now().toISOString().slice(0, 10), "near_limit");
        return;
      }
    }
    await alertOnce("near_limit", snapshot, { reason: "budget" });
  };

  /** The application-wide cap: paused for everyone, economy from the warning threshold, or ok. */
  const globalState = async (
    feature: GradyFeature,
    caps: AiCaps,
    at: Date,
  ): Promise<"ok" | "economy" | "paused"> => {
    if (!cached || at.getTime() - cached.at > SNAPSHOT_TTL_MS) {
      try {
        cached = { at: at.getTime(), snapshot: await loadBudget(admin, at, caps) };
      } catch (error) {
        console.error("grady budget read failed", error);
        return "ok";
      }
    }
    const { snapshot } = cached;
    if (snapshot.status === "near") {
      await alertNear(snapshot);
      return "economy";
    }
    if (snapshot.status !== "paused") return "ok";
    await alertOnce("paused", snapshot, { reason: "budget" });
    await paused(feature, { reason: "budget" });
    return "paused";
  };

  /** This user's own cap or block: stopped, economy from the warning threshold of it, or ok. */
  const userState = async (
    feature: GradyFeature,
    userId: string,
    caps: AiCaps,
    at: Date,
  ): Promise<"ok" | "economy" | "stop"> => {
    const limit = userLimit(caps, await loadUserOverride(admin, userId, { now: at.getTime() }));
    if (limit.kind === "none") return "ok";
    if (limit.kind === "blocked") {
      await paused(feature, { reason: "user_blocked" }, userId);
      return "stop";
    }
    let spent = userSpend.get(userId);
    if (!spent || at.getTime() - spent.at > SNAPSHOT_TTL_MS) {
      try {
        spent = {
          at: at.getTime(),
          spentUsd: await loadUserSpend(admin, userId, utcMonthStart(at)),
        };
        userSpend.set(userId, spent);
      } catch (error) {
        console.error("grady user spend read failed", error);
        return "ok";
      }
    }
    if (userAllowed(limit, spent.spentUsd)) {
      return userInEconomy(limit, spent.spentUsd, caps.warnShare) ? "economy" : "ok";
    }
    await paused(feature, { reason: "user_cap" }, userId);
    return "stop";
  };

  /**
   * The cap of the space: its owner's (exception or the per-user cap) on all
   * calls made in it. A blocked owner blocks only their own calls, not their
   * people's: the block is about a person, the cap about the money.
   */
  const spaceState = async (
    feature: GradyFeature,
    userId: string,
    spaceId: string,
    caps: AiCaps,
    at: Date,
  ): Promise<"ok" | "economy" | "stop"> => {
    const override = await loadUserOverride(admin, spaceId, { now: at.getTime() });
    const limit = userLimit(caps, override?.blocked ? { ...override, blocked: false } : override);
    if (limit.kind !== "cap") return "ok";
    let spent = spaceSpend.get(spaceId);
    if (!spent || at.getTime() - spent.at > SNAPSHOT_TTL_MS) {
      try {
        spent = { at: at.getTime(), spentUsd: await loadSpaceSpend(admin, spaceId, utcMonthStart(at)) };
        spaceSpend.set(spaceId, spent);
      } catch (error) {
        console.error("grady space spend read failed", error);
        return "ok";
      }
    }
    if (userAllowed(limit, spent.spentUsd)) {
      return userInEconomy(limit, spent.spentUsd, caps.warnShare) ? "economy" : "ok";
    }
    await paused(feature, { reason: "space_cap" }, userId);
    return "stop";
  };

  const assess = async (
    feature: GradyFeature,
    userId: string | null = null,
  ): Promise<BudgetAssessment> => {
    if (creditsOut) {
      await paused(feature, { reason: "credits", errorCode: "credits_exhausted" });
      return { verdict: "paused", economy: null };
    }
    const at = now();
    const caps = await loadAiCaps(admin, { now: at.getTime() });
    const global = await globalState(feature, caps, at);
    if (global === "paused") return { verdict: "paused", economy: null };
    let economy: EconomyReason | null = global === "economy" ? "budget" : null;
    if (userId) {
      const user = await userState(feature, userId, caps, at);
      if (user === "stop") return { verdict: "userLimit", economy: null };
      if (user === "economy") economy ??= "user_cap";
      const spaceId = options.spaceId ?? userId;
      const space = await spaceState(feature, userId, spaceId, caps, at);
      if (space === "stop") {
        return { verdict: spaceId === userId ? "userLimit" : "spaceLimit", economy: null };
      }
      if (space === "economy") economy ??= spaceId === userId ? "user_cap" : "space_cap";
    }
    return { verdict: "ok", economy };
  };

  return {
    assess,
    async check(feature, userId = null) {
      return (await assess(feature, userId)).verdict;
    },
    async creditsExhausted(feature, errorCode) {
      creditsOut = true;
      await paused(feature, { reason: "credits", errorCode });
      await alertOnce("paused", cached?.snapshot ?? null, { reason: "credits", errorCode });
    },
  };
}
