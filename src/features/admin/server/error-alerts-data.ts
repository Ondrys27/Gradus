import "server-only";
import { resolveErrorAlerts, type ErrorAlertSettings } from "@/features/errors/alerts/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { senderAddress } from "@/lib/email/resend";

/**
 * What the Error alerts page shows: the saved setting, when and by whom it
 * last changed, and whether e-mail can reach more than the Resend account's
 * own address yet (a sender on a verified domain, RESEND_FROM).
 */
export type ErrorAlertsPageData = {
  settings: ErrorAlertSettings;
  stored: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  /** The address the e-mails come from. */
  sender: string;
  /** No RESEND_FROM: Resend's test sender, which delivers only to the account's address. */
  testSender: boolean;
};

export async function loadErrorAlerts(): Promise<ErrorAlertsPageData> {
  const { data, error } = await createAdminClient()
    .from("app_settings")
    .select("value, updated_at, updated_by")
    .eq("key", "error_alerts")
    .maybeSingle();
  if (error) throw new Error(`app_settings error_alerts: ${error.message}`);
  const { stored, ...settings } = resolveErrorAlerts(data?.value);
  const sender = senderAddress();
  return {
    settings,
    stored,
    updatedAt: data?.updated_at ?? null,
    updatedBy: data?.updated_by ?? null,
    sender,
    testSender: !process.env.RESEND_FROM || /@resend\.dev>?$/i.test(sender),
  };
}

/** The record of one error found by its code, for the Feedback page's search. */
export type ErrorEventRow = {
  code: string;
  source: string;
  page: string;
  action: string | null;
  message: string;
  stack: string | null;
  digest: string | null;
  userId: string | null;
  browser: string | null;
  device: string | null;
  viewport: string | null;
  version: string | null;
  createdAt: string;
  /** The same error (fingerprint) in the 24 hours before this one, this one included. */
  dayCount: number;
  /** The server's record of the same failure (same digest), when the browser's is a copy. */
  server: { message: string; stack: string | null; action: string | null } | null;
};

export async function loadErrorEvent(code: string): Promise<ErrorEventRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("error_events")
    .select(
      "code, fingerprint, source, page, action, message, stack, digest, user_id, browser, device, viewport, app_version, created_at",
    )
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(`error_events: ${error.message}`);
  if (!data) return null;
  const at = new Date(data.created_at);
  const dayBefore = new Date(at.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count }, server] = await Promise.all([
    admin
      .from("error_events")
      .select("id", { count: "exact", head: true })
      .eq("fingerprint", data.fingerprint)
      .gt("created_at", dayBefore)
      .lte("created_at", data.created_at),
    data.digest && data.source === "boundary"
      ? admin
          .from("error_events")
          .select("message, stack, action")
          .eq("digest", data.digest)
          .in("source", ["render", "route", "action", "middleware"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    code: data.code,
    source: data.source,
    page: data.page,
    action: data.action,
    message: data.message,
    stack: data.stack,
    digest: data.digest,
    userId: data.user_id,
    browser: data.browser,
    device: data.device,
    viewport: data.viewport,
    version: data.app_version,
    createdAt: data.created_at,
    dayCount: count ?? 1,
    server: server.data ?? null,
  };
}
