import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";
import { parseEvent, type EventName, type EventProps } from "./events";

type Admin = SupabaseClient<Database>;

export type TrackOptions = {
  /**
   * Who did it. Omitted: the signed-in user of this request. `null`: a system
   * event with no person (a cron run, a timing, the waitlist).
   */
  userId?: string | null;
  /** The workspace owner, when the caller already knows it; otherwise the database finds it. */
  ownerId?: string;
  /** Reuse the caller's admin client. */
  admin?: Admin;
};

async function sessionUserId(): Promise<string | null> {
  try {
    const { data } = await (await createClient()).auth.getClaims();
    return data?.claims?.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Records one event from the catalog. Validates the props, writes with the
 * admin client and never throws: a lost event must never break what the user
 * did. Problems go to the server log.
 */
export async function track<E extends EventName>(
  event: E,
  props: EventProps<E>,
  options: TrackOptions = {},
): Promise<void> {
  try {
    const parsed = parseEvent(event, props, "server");
    if (!parsed.ok) {
      console.error(`[analytics] ${event} refused: ${parsed.reason}`);
      return;
    }
    const userId = options.userId === undefined ? await sessionUserId() : options.userId;
    const admin = options.admin ?? createAdminClient();
    const { error } = await admin.from("analytics_events").insert({
      event: parsed.event,
      props: parsed.props as Json,
      user_id: userId,
      ...(options.ownerId && userId ? { owner_id: options.ownerId } : {}),
    });
    if (error) console.error(`[analytics] ${event} insert failed`, error.code);
  } catch (error) {
    console.error(`[analytics] ${event} failed`, error instanceof Error ? error.name : "unknown");
  }
}

/**
 * track() after the response has gone out, so the user never waits for it.
 * Outside a request (tests, scripts) it simply runs now.
 */
export function trackLater<E extends EventName>(
  event: E,
  props: EventProps<E>,
  options: TrackOptions = {},
): void {
  const run = () => track(event, props, options);
  try {
    after(run);
  } catch {
    void run();
  }
}
