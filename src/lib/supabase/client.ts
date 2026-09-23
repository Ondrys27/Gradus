"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { supabasePublicKey, supabaseUrl } from "./env";

let client: SupabaseClient<Database> | undefined;

/** One browser client per tab; the session lives in cookies shared with the server. */
export function createClient(): SupabaseClient<Database> {
  client ??= createBrowserClient<Database>(supabaseUrl(), supabasePublicKey());
  return client;
}
