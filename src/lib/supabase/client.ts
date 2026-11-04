"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { supabasePublicKey, supabaseUrl } from "./env";

let client: SupabaseClient<Database> | undefined;

/** One browser client per tab; the session lives in cookies shared with the server. */
export function createClient(): SupabaseClient<Database> {
  client ??= createBrowserClient<Database>(supabaseUrl(), supabasePublicKey());
  return client;
}

let topics = 0;

/**
 * A Realtime topic of its own for each subscription. `channel()` hands back an
 * existing channel of the same name, so an effect that runs again (Strict Mode,
 * changed dependencies) would get the channel its cleanup is just removing and
 * hear nothing.
 */
export function realtimeTopic(name: string): string {
  topics += 1;
  return `${name}-${topics}`;
}

/**
 * Joins a Realtime channel with the signed-in session's token. Joined before
 * the session is read from the cookies, Realtime checks the subscription as
 * anon, refuses every table the policies keep from anon and stays silent.
 * Returns the cleanup for the effect.
 */
export function subscribeSignedIn(
  supabase: SupabaseClient<Database>,
  channel: RealtimeChannel,
): () => void {
  let live = true;
  void supabase.realtime
    .setAuth()
    .catch(() => undefined)
    .then(() => {
      if (live) channel.subscribe();
    });
  return () => {
    live = false;
    void supabase.removeChannel(channel);
  };
}
