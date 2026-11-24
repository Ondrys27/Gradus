import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { ProviderKey } from "../types";
import { reportMissingConfiguration, syncConfiguration } from "./connections";
import { isCalendarSyncAllowed } from "./settings";

type Admin = SupabaseClient<Database>;

/**
 * The one door to two-way sync (28.10), for every route and action: a
 * signed-in account, let in by the switch (the database decides), on a
 * server that has the key (and, for Google, its OAuth client). An account
 * outside the allowlist gets `notAllowed` from a direct call just as from
 * the screen; a missing key is the owner's to fix and reaches the error log.
 */

export type GateError = "unauthenticated" | "notAllowed" | "unavailable";
export type GateResult = { ok: true; userId: string; admin: Admin } | { ok: false; error: GateError };

export type GateInput = {
  userId: string | null;
  allowed: boolean;
  configuration: { key: boolean; google: boolean; apple: boolean };
  provider: ProviderKey | null;
};

/** The decision alone (Vitest): who passes, and what is missing when nobody can. */
export function decideGate(
  input: GateInput,
): { ok: true } | { ok: false; error: GateError; missing?: "key" | "google" } {
  if (!input.userId) return { ok: false, error: "unauthenticated" };
  if (!input.allowed) return { ok: false, error: "notAllowed" };
  if (!input.configuration.key) return { ok: false, error: "unavailable", missing: "key" };
  if (input.provider === "google" && !input.configuration.google) {
    return { ok: false, error: "unavailable", missing: "google" };
  }
  return { ok: true };
}

export async function sessionUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return typeof userId === "string" && userId ? userId : null;
}

export async function calendarSyncGate(
  action: string,
  provider: ProviderKey | null = null,
): Promise<GateResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: "unauthenticated" };
  const admin = createAdminClient();
  const allowed = await isCalendarSyncAllowed(admin, userId);
  const decision = decideGate({ userId, allowed, configuration: syncConfiguration(), provider });
  if (!decision.ok) {
    if (decision.missing) reportMissingConfiguration(decision.missing, { userId, action });
    return { ok: false, error: decision.error };
  }
  return { ok: true, userId, admin };
}
