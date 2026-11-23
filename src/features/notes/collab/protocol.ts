/**
 * The messages of a note's live channel (Supabase Realtime broadcast, one
 * event "collab"). Bytes travel as base64. A message too big for one
 * Realtime payload goes in parts and is put back together on arrival.
 *
 * - update: a change (several typed letters together), numbered per tab
 *   (`q`); `p` marks one that is already in the database (merged from it).
 * - hello: a writer joined with its state vector; the others answer `sync`.
 * - sync: what the one addressed lacked, with the sender's state vector, so
 *   it sends back what the sender lacks (a returning offline writer).
 * - awareness: cursors and names (y-protocols awareness).
 * - saved: the note is in the database at this version, with the sender's
 *   changes up to number `upTo` in it.
 * - reset: the note was rebuilt or replaced; an older generation reloads.
 */
import { COLLAB } from "./limits";

export type CollabMessage =
  | { t: "update"; gen: string; d: string; q?: number; p?: 1 }
  | { t: "hello"; gen: string; sv: string }
  | { t: "sync"; gen: string; to: string; d: string; sv: string }
  | { t: "awareness"; d: string }
  | { t: "saved"; gen: string; v: number; upTo: number }
  | { t: "reset"; gen: string };

/** Who sent it: the account and its tab (one session per note and tab). */
export type Envelope = { from: string; sid: string; m: CollabMessage };

export type Part = { part: string; i: number; n: number; s: string; from: string; sid: string };

export type Wire = Envelope | Part;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

const KINDS = new Set(["update", "hello", "sync", "awareness", "saved", "reset"]);

/** A message from the channel, or null when it is not one of ours. */
export function parseEnvelope(value: unknown): Envelope | null {
  if (!isObject(value) || typeof value.from !== "string" || typeof value.sid !== "string") return null;
  const m = value.m;
  if (!isObject(m) || typeof m.t !== "string" || !KINDS.has(m.t)) return null;
  switch (m.t) {
    case "update":
      return typeof m.gen === "string" &&
        typeof m.d === "string" &&
        (m.q === undefined || typeof m.q === "number") &&
        (m.p === undefined || m.p === 1)
        ? (value as Envelope)
        : null;
    case "hello":
      return typeof m.gen === "string" && typeof m.sv === "string" ? (value as Envelope) : null;
    case "sync":
      return typeof m.gen === "string" && typeof m.to === "string" && typeof m.d === "string" && typeof m.sv === "string"
        ? (value as Envelope)
        : null;
    case "awareness":
      return typeof m.d === "string" ? (value as Envelope) : null;
    case "saved":
      return typeof m.gen === "string" && typeof m.v === "number" && typeof m.upTo === "number"
        ? (value as Envelope)
        : null;
    case "reset":
      return typeof m.gen === "string" ? (value as Envelope) : null;
  }
  return null;
}

function isPart(value: unknown): value is Part {
  return (
    isObject(value) &&
    typeof value.part === "string" &&
    typeof value.i === "number" &&
    typeof value.n === "number" &&
    typeof value.s === "string" &&
    typeof value.from === "string" &&
    typeof value.sid === "string"
  );
}

/** The payloads to send for one message: itself, or its parts when it is too big. */
export function toWire(envelope: Envelope, max: number = COLLAB.chunkChars, id = crypto.randomUUID()): Wire[] {
  const text = JSON.stringify(envelope);
  if (text.length <= max) return [envelope];
  const n = Math.ceil(text.length / max);
  return Array.from({ length: n }, (_, i) => ({
    part: id,
    i,
    n,
    s: text.slice(i * max, (i + 1) * max),
    from: envelope.from,
    sid: envelope.sid,
  }));
}

/** Puts parted messages back together; parts that never complete are forgotten after a while. */
export class WireAssembler {
  private pending = new Map<string, { parts: string[]; got: number; at: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 30_000,
  ) {}

  /** The whole message once it is complete, otherwise null. */
  take(payload: unknown): Envelope | null {
    if (!isPart(payload)) return parseEnvelope(payload);
    const now = this.now();
    for (const [key, entry] of this.pending) if (now - entry.at > this.ttlMs) this.pending.delete(key);
    if (payload.n < 1 || payload.n > 200 || payload.i < 0 || payload.i >= payload.n) return null;
    const key = `${payload.sid}:${payload.part}`;
    const entry = this.pending.get(key) ?? { parts: new Array<string>(payload.n), got: 0, at: now };
    if (entry.parts.length !== payload.n) return null;
    if (entry.parts[payload.i] === undefined) {
      entry.parts[payload.i] = payload.s;
      entry.got += 1;
    }
    this.pending.set(key, entry);
    if (entry.got < payload.n) return null;
    this.pending.delete(key);
    try {
      return parseEnvelope(JSON.parse(entry.parts.join("")));
    } catch {
      return null;
    }
  }
}
