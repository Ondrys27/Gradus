import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_PATH } from "@/features/admin/access";
import { ownerContact } from "@/features/jarvis/server/owner";
import { sendEmail, type EmailResult } from "@/lib/email/resend";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import { ERROR_ALERT_LIMITS, resolveErrorAlerts } from "../settings";
import {
  digestAlertEmail,
  errorAlertEmail,
  overflowAlertEmail,
  testAlertEmail,
  type AlertUser,
  type DigestGroup,
  type EmailContent,
} from "../template";

/**
 * Sending the e-mails about errors. What to send is decided in the database
 * (error_alert_claim, error_alert_digest_claim) under a lock, so parallel
 * errors never send twice; this module writes the e-mail and hands it to
 * Resend, one message per address (until RESEND_FROM has a verified domain,
 * Resend takes only the account's own address, and one refused address must
 * not stop the others). It never throws: a failure is logged and kept on the
 * send row.
 */

type Admin = SupabaseClient<Database>;
type Send = (message: Parameters<typeof sendEmail>[0]) => Promise<EmailResult>;

export type AlertDeps = {
  admin?: Admin;
  /** Resend, replaced in tests. */
  send?: Send;
  /** The site's address for the links; read from the environment when omitted. */
  origin?: string | null;
  /** Pause between two addresses (Resend allows a few requests a second). */
  spacingMs?: number;
};

export const ERROR_ALERTS_PATH = `${ADMIN_PATH}/upozorneni`;
const FEEDBACK_PATH = `${ADMIN_PATH}/zpetna-vazba`;
const DEFAULT_SPACING_MS = 600;

/** The base of links in the e-mails: the configured site, else Vercel's production address. */
export function alertOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return null;
}

/** The administration's page that finds this error (and its bug report) by code. */
export function errorAdminUrl(origin: string | null, code?: string): string | null {
  if (!origin) return null;
  return code
    ? `${origin}${FEEDBACK_PATH}?code=${encodeURIComponent(code)}`
    : `${origin}${FEEDBACK_PATH}`;
}

function emailsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Delivery = { sent: number; total: number; failure: string | null };

/**
 * Sends one e-mail to every address and finishes its row in
 * error_alert_sends. The tests' mock transport sends nothing and keeps the
 * message on the row instead.
 */
async function deliver(
  admin: Admin,
  sendId: string,
  transport: "resend" | "mock",
  recipients: string[],
  content: EmailContent,
  deps: AlertDeps,
): Promise<Delivery> {
  const now = () => new Date().toISOString();
  if (transport === "mock") {
    const { error } = await admin
      .from("error_alert_sends")
      .update({
        status: "sent",
        sent_at: now(),
        message: { to: recipients, subject: content.subject, text: content.text },
      })
      .eq("id", sendId);
    if (error) console.error("[error-alerts] mock send not stored", error.code ?? error.message);
    return { sent: recipients.length, total: recipients.length, failure: null };
  }

  const send = deps.send ?? sendEmail;
  const spacing = deps.spacingMs ?? DEFAULT_SPACING_MS;
  let sent = 0;
  const failures: string[] = [];
  for (const [index, to] of recipients.entries()) {
    if (index > 0 && spacing > 0) await sleep(spacing);
    const result = await send({ to, ...content }).catch((error: unknown): EmailResult => ({
      ok: false,
      error: error instanceof Error ? error.message : "unknown",
    }));
    if (result.ok) sent += 1;
    else failures.push(result.error);
  }
  const failure = failures.length
    ? `${failures.length}/${recipients.length}: ${failures[0]}`.slice(0, 300)
    : null;
  if (failure) console.error("[error-alerts] e-mail failed", failure);
  const { error } = await admin
    .from("error_alert_sends")
    .update({ status: sent > 0 ? "sent" : "failed", sent_at: now(), failure })
    .eq("id", sendId);
  if (error) console.error("[error-alerts] send row not finished", error.code ?? error.message);
  return { sent, total: recipients.length, failure };
}

/** Who the error happened to, as the e-mail names them. */
async function alertUser(admin: Admin, userId: string): Promise<AlertUser> {
  const [people, profile, plan] = await Promise.all([
    admin.rpc("admin_people", { _ids: [userId] }),
    admin.from("profiles").select("is_internal").eq("id", userId).maybeSingle(),
    admin.rpc("current_plan", { _user_id: userId }),
  ]);
  const person = people.data?.[0];
  const current = plan.data?.[0];
  return {
    id: userId,
    name: person?.display_name?.trim() || null,
    email: person?.email ?? null,
    plan: current?.plan_key ?? null,
    planStatus: current?.status ?? null,
    internal: profile.data?.is_internal ?? false,
  };
}

export type DispatchResult =
  "send" | "overflow" | "throttled" | "digest" | "suppressed" | "off" | "skip" | "failed";

/**
 * After an error was recorded: asks the database whether to e-mail it (the
 * flood rules) and sends what it says. Never throws.
 */
export async function dispatchErrorAlert(
  eventId: string,
  deps: AlertDeps = {},
): Promise<DispatchResult> {
  try {
    const admin = deps.admin ?? createAdminClient();
    const { data, error } = await admin.rpc("error_alert_claim", {
      _event_id: eventId,
      _fingerprint_minutes: ERROR_ALERT_LIMITS.fingerprintMinutes,
      _hourly_limit: ERROR_ALERT_LIMITS.perHour,
    });
    if (error) throw new Error(`error_alert_claim: ${error.code ?? error.message}`);
    const claim = data?.[0];
    const decision = (claim?.decision ?? "skip") as DispatchResult;
    if ((decision !== "send" && decision !== "overflow") || !claim?.send_id) return decision;

    const recipients = emailsOf(claim.recipients);
    const { data: event, error: eventError } = await admin
      .from("error_events")
      .select(
        "code, source, page, action, message, stack, browser, device, viewport, app_version, user_id, transport, created_at",
      )
      .eq("id", eventId)
      .maybeSingle();
    if (eventError || !event) throw new Error("error event not readable");

    const origin = deps.origin === undefined ? alertOrigin() : deps.origin;
    const [owner, user] = await Promise.all([
      ownerContact(admin).catch(() => ({ email: null, locale: null })),
      event.user_id ? alertUser(admin, event.user_id) : Promise.resolve(null),
    ]);
    const content =
      decision === "overflow"
        ? overflowAlertEmail({ adminUrl: errorAdminUrl(origin) }, owner.locale)
        : errorAlertEmail(
            {
              event: {
                code: event.code,
                source: event.source,
                page: event.page,
                action: event.action,
                message: event.message,
                stack: event.stack,
                browser: event.browser,
                device: event.device,
                viewport: event.viewport,
                appVersion: event.app_version,
                createdAt: event.created_at,
              },
              user,
              dayCount: claim.day_count ?? 1,
              sinceLast: claim.since_last ?? 0,
              adminUrl: errorAdminUrl(origin, event.code),
            },
            owner.locale,
          );
    const transport = event.transport === "mock" ? "mock" : "resend";
    await deliver(admin, claim.send_id, transport, recipients, content, deps);
    return decision;
  } catch (error) {
    console.error(
      "[error-alerts] dispatch failed",
      error instanceof Error ? error.message : "unknown",
    );
    return "failed";
  }
}

/**
 * The daily summary (cron, digest mode): the errors that waited since the
 * last one. Nothing to say, nothing sent.
 */
export async function sendErrorAlertDigest(
  deps: AlertDeps = {},
): Promise<{ sent: boolean; errors: number }> {
  const admin = deps.admin ?? createAdminClient();
  const { data, error } = await admin.rpc("error_alert_digest_claim", { _max_groups: 50 });
  if (error) throw new Error(`error_alert_digest_claim: ${error.code ?? error.message}`);
  const claim = data?.[0];
  if (!claim?.send_id) return { sent: false, errors: 0 };
  const groups = (Array.isArray(claim.groups) ? claim.groups : []) as unknown as DigestGroup[];
  const owner = await ownerContact(admin).catch(() => ({ email: null, locale: null }));
  const origin = deps.origin === undefined ? alertOrigin() : deps.origin;
  const delivery = await deliver(
    admin,
    claim.send_id,
    "resend",
    emailsOf(claim.recipients),
    digestAlertEmail({ groups, total: claim.total, adminUrl: errorAdminUrl(origin) }, owner.locale),
    deps,
  );
  return { sent: delivery.sent > 0, errors: claim.total };
}

export type TestAlertResult =
  { ok: true; delivery: Delivery } | { ok: false; error: "noRecipients" | "limited" | "failed" };

/** "Send a test e-mail": to the saved addresses, a few times an hour at most. */
export async function sendTestErrorAlert(deps: AlertDeps = {}): Promise<TestAlertResult> {
  const admin = deps.admin ?? createAdminClient();
  const { data: row, error } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "error_alerts")
    .maybeSingle();
  if (error) return { ok: false, error: "failed" };
  const settings = resolveErrorAlerts(row?.value);
  if (!settings.emails.length) return { ok: false, error: "noRecipients" };

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await admin
    .from("error_alert_sends")
    .select("id", { count: "exact", head: true })
    .eq("kind", "test")
    .gte("created_at", hourAgo);
  if (countError) return { ok: false, error: "failed" };
  if ((count ?? 0) >= ERROR_ALERT_LIMITS.testsPerHour) return { ok: false, error: "limited" };

  const { data: send, error: insertError } = await admin
    .from("error_alert_sends")
    .insert({ kind: "test", transport: "resend", events: 0, recipients: settings.emails.length })
    .select("id")
    .single();
  if (insertError || !send) return { ok: false, error: "failed" };

  const owner = await ownerContact(admin).catch(() => ({ email: null, locale: null }));
  const origin = deps.origin === undefined ? alertOrigin() : deps.origin;
  const delivery = await deliver(
    admin,
    send.id,
    "resend",
    settings.emails,
    testAlertEmail(
      { emails: settings.emails, adminUrl: origin ? `${origin}${ERROR_ALERTS_PATH}` : null },
      owner.locale,
    ),
    deps,
  );
  return { ok: true, delivery };
}
