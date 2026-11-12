"use client";

import { track } from "@/lib/analytics/client";
import type { ClientEventName } from "@/lib/analytics/events";
import { createClient } from "@/lib/supabase/client";
import type { OpsEnv, OpsTrack } from "./ops";

/** The browser's side of a shared write: the user's client and the browser's analytics queue. */
export function clientOps(): OpsEnv {
  const record: OpsTrack = (event, props) =>
    track(event as ClientEventName, props as Parameters<typeof track>[1]);
  return { db: createClient(), track: record };
}
