"use server";

import { track } from "@/lib/analytics/track";
import { createAdminClient } from "@/lib/supabase/admin";
import { looksLikeWorkerInvite } from "./invite-code";
import { canRequestNewInvite } from "./invite-link";
import { loadWorkerInviteLink } from "./worker-invite";

export type RequestNewInviteResult = { ok: true; sent: boolean } | { ok: false };

/**
 * "Ask for a new one" under a link that no longer works (27.1), signed in or
 * not: the owner of the invite gets a notification in the app. The code is
 * the only proof; nothing about the owner comes back, and the database lets
 * one request a day per invite through (worker_invite_request_new).
 */
export async function requestNewInvite(code: string): Promise<RequestNewInviteResult> {
  if (typeof code !== "string" || !looksLikeWorkerInvite(code)) return { ok: false };
  try {
    const { state } = (await loadWorkerInviteLink(code)).status;
    if (!canRequestNewInvite(state)) return { ok: false };
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("worker_invite_request_new", { _code: code.trim() });
    if (error) throw error;
    if (data === "unknown") return { ok: false };
    await track(
      "worker_invite_new_requested",
      { state, sent: data === "sent" },
      { admin },
    );
    return { ok: true, sent: data === "sent" };
  } catch (error) {
    console.error("[auth] new invite request failed", (error as { code?: string })?.code ?? "unknown");
    return { ok: false };
  }
}
