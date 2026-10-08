import { z } from "zod";
import { parseEvent, type EventName } from "./events";

/** Events (and heartbeats) one user may send per minute. */
export const CLIENT_RATE_LIMIT = 120;
/** Events in one request; the browser flushes far smaller batches. */
export const MAX_BATCH = 50;
/** Bytes of one request body. */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * What the browser sends to /api/t. Strict: a user id (or anything else)
 * next to the events refuses the request — the user always comes from the
 * session.
 */
const envelopeSchema = z.strictObject({
  events: z.array(z.unknown()).max(MAX_BATCH).optional(),
  heartbeat: z.boolean().optional(),
});
const itemSchema = z.strictObject({
  event: z.string().max(64),
  props: z.record(z.string(), z.unknown()).optional(),
});

export type IngestRow = { event: EventName; props: Record<string, unknown> };

export type IngestDeps = {
  /** The signed-in user from the session cookie, or null. */
  userId: string | null;
  /** Takes up to `units` from this minute's allowance; returns how many were granted. */
  takeQuota: (userId: string, units: number) => Promise<number>;
  /** Extends or starts the user's session; returns its id. */
  touchSession: (userId: string) => Promise<string | null>;
  insert: (userId: string, sessionId: string | null, rows: IngestRow[]) => Promise<void>;
};

export type IngestResult = {
  status: 200 | 400 | 401 | 429;
  body: { accepted: number; rejected: number; limited: number } | { error: string };
};

/**
 * The work of POST /api/t: validates the batch against the catalog (client
 * events only), applies the per-user rate limit, extends the session and
 * stores what passed — always under the session's user.
 */
export async function ingest(payload: unknown, deps: IngestDeps): Promise<IngestResult> {
  const { userId } = deps;
  if (!userId) return { status: 401, body: { error: "unauthorized" } };

  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return { status: 400, body: { error: "invalid" } };
  const heartbeat = envelope.data.heartbeat === true;

  const valid: IngestRow[] = [];
  let rejected = 0;
  for (const raw of envelope.data.events ?? []) {
    const item = itemSchema.safeParse(raw);
    const parsed = item.success ? parseEvent(item.data.event, item.data.props, "client") : null;
    if (parsed?.ok) valid.push({ event: parsed.event, props: parsed.props });
    else rejected += 1;
  }

  const units = valid.length + (heartbeat ? 1 : 0);
  if (units === 0) return { status: 200, body: { accepted: 0, rejected, limited: 0 } };

  const granted = await deps.takeQuota(userId, units);
  if (granted <= 0) {
    return { status: 429, body: { accepted: 0, rejected, limited: valid.length } };
  }
  // The heartbeat takes its unit first; it is what keeps the session counting.
  const allowed = valid.slice(0, Math.max(0, granted - (heartbeat ? 1 : 0)));
  const sessionId = await deps.touchSession(userId);
  if (allowed.length) await deps.insert(userId, sessionId, allowed);
  return {
    status: 200,
    body: { accepted: allowed.length, rejected, limited: valid.length - allowed.length },
  };
}
