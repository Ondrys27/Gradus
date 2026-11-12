import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Billing, PaidPlanKey } from "@/config/pricing";
import { ownerContact } from "@/features/grady/server/feature-requests";
import { serverTranslator } from "@/i18n/server-translator";
import { APP_NAME } from "@/lib/constants";
import { escapeHtml, sendEmail } from "@/lib/email/resend";
import type { Database } from "@/types/database";
import { planName } from "./catalog";
import { getPublishedPlans } from "./catalog-server";

type Client = SupabaseClient<Database>;

/** One e-mail per plan, period and person this often; another request stays quiet. */
const REPEAT_AFTER_MS = 60 * 60_000;
const EVENT = "subscription_change_requested";
const TEST_DOMAIN = /@gradus\.local$/i;

/**
 * Until a payment gateway exists, the app owner learns about every plan a
 * user asks for and sets it in the administration. Never throws; true when
 * an e-mail went out (or one went out within the hour already).
 */
export async function notifyPlanRequest({
  admin,
  userId,
  email,
  planKey,
  billing,
  current,
}: {
  admin: Client;
  userId: string;
  email: string | null;
  planKey: PaidPlanKey;
  billing: Billing;
  /** The plan before the change: key, status and trial end. */
  current: { plan_key: string; status: string; trial_ends_at: string | null } | null;
}): Promise<boolean> {
  // Test and demo accounts (@gradus.local) ask for plans in end-to-end runs; nobody needs to hear of it.
  if (email && TEST_DOMAIN.test(email)) return false;
  try {
    const since = new Date(Date.now() - REPEAT_AFTER_MS).toISOString();
    const { count, error: countError } = await admin
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("event", EVENT)
      .contains("props", { to_plan: planKey, billing })
      .gte("created_at", since);
    if (countError) console.error("[plan] request lookup failed", countError.code);
    if (count) return true;

    const [owner, plans] = await Promise.all([ownerContact(admin), getPublishedPlans()]);
    if (!owner.email) return false;
    const t = serverTranslator(owner.locale);
    // Names from the published catalog in the owner's language; beta is outside it.
    const nameOf = (key: string) =>
      planName(plans, key, owner.locale ?? "en") ?? (key === "beta" ? t("plans.names.beta") : key);
    const requested = `${nameOf(planKey)} · ${t(`plans.billing.${billing}`)}`;
    const status = current
      ? [nameOf(current.plan_key), current.status, current.trial_ends_at].filter(Boolean).join(" · ")
      : "-";
    const lines = [
      t("plans.interestEmail.intro", { plan: requested }),
      `${t("plans.interestEmail.from")}: ${email ?? userId}`,
      `${t("plans.interestEmail.status")}: ${status}`,
    ];
    const sent = await sendEmail({
      to: owner.email,
      subject: t("plans.interestEmail.subject", { appName: APP_NAME, plan: requested }),
      text: lines.join("\n"),
      html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n"),
    });
    if (!sent.ok) console.error("[plan] request e-mail failed", sent.error);
    return sent.ok;
  } catch (error) {
    console.error("[plan] request e-mail failed", error instanceof Error ? error.name : "unknown");
    return false;
  }
}
