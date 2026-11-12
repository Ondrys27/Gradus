import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventName, EventProps } from "@/lib/analytics/events";
import type { Database } from "@/types/database";

/**
 * What a shared write needs (src/features/<section>/ops.ts): the Supabase
 * client of the signed-in user and a way to record the event. The screens
 * pass the browser client and the browser's track(); Grady's tools pass the
 * server client of the same user and the server's track(). Either way the
 * write goes through row level security, the guards and read-only mode, and
 * the analytics are the same as when the user works by hand.
 */
export type Db = SupabaseClient<Database>;

export type OpsTrack = <E extends EventName>(event: E, props: EventProps<E>) => void;

export type OpsEnv = { db: Db; track: OpsTrack };
