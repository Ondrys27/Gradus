import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { measure } from "@/lib/analytics/instrument";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

/**
 * What every action of Settings → Subscription shares: the user comes from
 * the session and must be the owner of their workspace (a worker pays for
 * nothing); failures come back as codes, never thrown.
 */

export type SubscriptionErrorCode =
  | "ownerOnly"
  | "invalid"
  | "notAllowed"
  | "cancelPending"
  | "expired"
  /** Payments are off here (no key, the wrong key, or a mode this account may not use). */
  | "paymentsUnavailable"
  /** Nothing runs in Stripe yet: the change is a Checkout. */
  | "checkoutRequired"
  /** Stripe refused or could not be reached; nothing changed. */
  | "gatewayFailed"
  | "unknown";

export type SubscriptionResult<T> = { ok: true; data: T } | { ok: false; error: SubscriptionErrorCode };

type Client = SupabaseClient<Database>;
export type SubscriptionContext = { supabase: Client; admin: Client; userId: string; email: string | null };

export class SubscriptionError extends Error {
  constructor(readonly code: SubscriptionErrorCode) {
    super(code);
  }
}

async function ownerContext(): Promise<SubscriptionContext> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string" || !userId) throw new SubscriptionError("ownerOnly");
  const { data: workspaceId, error } = await supabase.rpc("current_workspace_id");
  if (error) throw error;
  if (workspaceId !== userId) throw new SubscriptionError("ownerOnly");
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  return { supabase, admin: createAdminClient(), userId, email };
}

/** What the database functions raise, as codes. */
function fromDatabase(error: { code?: string; message?: string }): SubscriptionError | null {
  const message = error.message ?? "";
  if (error.code === "22023") return new SubscriptionError("invalid");
  if (error.code === "42501") return new SubscriptionError("notAllowed");
  if (error.code === "55000" && message.includes("cancel_pending")) {
    return new SubscriptionError("cancelPending");
  }
  if (error.code === "55000" && message.includes("expired")) return new SubscriptionError("expired");
  return null;
}

export function runSubscription<T>(
  name: string,
  work: (ctx: SubscriptionContext) => Promise<T>,
): Promise<SubscriptionResult<T>> {
  return measure(`subscription.${name}`, async (): Promise<SubscriptionResult<T>> => {
    try {
      return { ok: true, data: await work(await ownerContext()) };
    } catch (error) {
      if (error instanceof SubscriptionError) return { ok: false, error: error.code };
      const known = fromDatabase(error as { code?: string; message?: string });
      if (known) return { ok: false, error: known.code };
      console.error(`subscription action ${name} failed`, error);
      return { ok: false, error: "unknown" };
    }
  })();
}

export async function rpc<T>(call: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await call;
  if (error) throw error;
  return data as T;
}
