"use server";

import { isPaidPlanKey } from "@/config/pricing";
import { ownerContact } from "@/features/jarvis/server/feature-requests";
import { serverTranslator } from "@/i18n/server-translator";
import { APP_NAME } from "@/lib/constants";
import { escapeHtml, sendEmail } from "@/lib/email/resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const EVENT = "plan_interest";
const KNOWN_PLANS = ["solo", "pro", "team", "beta"] as const;
/** One e-mail per plan and person this often; another click just thanks again. */
const REPEAT_AFTER_MS = 60 * 60_000;

/**
 * "I'm interested" on the plan page, until a payment gateway exists: the app
 * owner gets an e-mail, the request is logged in usage_events (server only).
 */
export async function requestPlan(planKey: string): Promise<{ ok: boolean }> {
  if (!isPaidPlanKey(planKey)) return { ok: false };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { ok: false };
  const email = typeof claims.claims.email === "string" ? claims.claims.email : null;

  const admin = createAdminClient();
  const since = new Date(Date.now() - REPEAT_AFTER_MS).toISOString();
  const { count, error: countError } = await admin
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("event_type", EVENT)
    .eq("success", true)
    .contains("metadata", { plan: planKey })
    .gte("created_at", since);
  if (countError) console.error("[plan] interest lookup failed", countError);
  if (count) return { ok: true };

  const { data: planRows } = await supabase.rpc("current_plan", { _user_id: userId });
  const current = planRows?.[0];
  const owner = await ownerContact(admin);
  const t = serverTranslator(owner.locale);
  const planName = t(`plans.names.${planKey}`);
  const currentName =
    current && (KNOWN_PLANS as readonly string[]).includes(current.plan_key)
      ? t(`plans.names.${current.plan_key as (typeof KNOWN_PLANS)[number]}`)
      : (current?.plan_key ?? "-");
  const status = current
    ? [currentName, current.status, current.trial_ends_at].filter(Boolean).join(" · ")
    : "-";
  const lines = [
    t("plans.interestEmail.intro", { plan: planName }),
    `${t("plans.interestEmail.from")}: ${email ?? userId}`,
    `${t("plans.interestEmail.status")}: ${status}`,
  ];
  const sent = owner.email
    ? await sendEmail({
        to: owner.email,
        subject: t("plans.interestEmail.subject", { appName: APP_NAME, plan: planName }),
        text: lines.join("\n"),
        html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n"),
      })
    : ({ ok: false, error: "no owner e-mail" } as const);
  if (!sent.ok) console.error("[plan] interest e-mail failed", sent.error);

  const { error: logError } = await admin.from("usage_events").insert({
    user_id: userId,
    event_type: EVENT,
    success: sent.ok,
    message: sent.ok ? null : sent.error,
    metadata: { plan: planKey },
  });
  if (logError) console.error("[plan] usage_events insert failed", logError);
  return { ok: sent.ok };
}
