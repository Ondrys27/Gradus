"use client";

import { parseEvent, type ClientEventName, type EventProps } from "./events";

/**
 * The browser side of analytics: events wait in a small queue and go to
 * /api/t in batches — a few seconds after the last one, at once when the
 * queue fills, and through sendBeacon when the page is hidden or closed.
 * Nothing here ever throws into the code that tracks.
 */

const ENDPOINT = "/api/t";
const FLUSH_DELAY_MS = 4000;
const FLUSH_AT = 20;
/** Never more than this waits; the oldest go first when a broken network piles them up. */
const QUEUE_MAX = 200;
/** One request carries at most this many events. */
const BATCH_MAX = 50;
/** How long signing out waits for the last batch before it gives up on it. */
export const END_TIMEOUT_MS = 3000;

type Item = { event: string; props: Record<string, unknown> };

const queue: Item[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
/** Set once the tab signs out: whatever comes after would reach /api/t without a session. */
let stopped = false;

function enabled(): boolean {
  return typeof window !== "undefined" && process.env.NODE_ENV !== "test" && !stopped;
}

/** Records an event from the catalog. Invalid props are dropped (and reported while developing). */
export function track<E extends ClientEventName>(event: E, props: EventProps<E>): void {
  if (!enabled()) return;
  try {
    const parsed = parseEvent(event, props, "client");
    if (!parsed.ok) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[analytics] ${event} dropped: ${parsed.reason}`, props);
      }
      return;
    }
    listen();
    queue.push({ event: parsed.event, props: parsed.props });
    if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX);
    if (queue.length >= FLUSH_AT) flush();
    else schedule();
  } catch {
    // Measuring must never break the app.
  }
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, FLUSH_DELAY_MS);
}

function send(body: string, beacon: boolean): boolean {
  try {
    if (beacon && typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      return navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Sends what waits; `heartbeat` also tells the server the person is here. */
export function flush(options: { beacon?: boolean; heartbeat?: boolean } = {}): void {
  if (!enabled()) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length && !options.heartbeat) return;
  const events = queue.splice(0, BATCH_MAX);
  const body = JSON.stringify(options.heartbeat ? { events, heartbeat: true } : { events });
  send(body, options.beacon === true);
  if (queue.length) schedule();
}

/**
 * Ends measuring for the rest of this page once the session is gone (sign-out
 * leaves the page right after). Events tracked between the last flush and the
 * page leaving would otherwise go out with the pagehide beacon, without a
 * session, and come back 401.
 */
export function stopTracking(): void {
  stopped = true;
  queue.length = 0;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Sends the last events of a session and waits until the server has them,
 * then stops measuring for the rest of the page. Signing out calls it before
 * the session ends: a beacon fired just before sign-out is not on its way yet
 * (the browser may hold it behind the page's other requests and attaches the
 * cookies only when it finally goes), so it could leave after the session
 * cookies were removed and come back 401. Events tracked meanwhile are
 * dropped; a request still not answered after `timeoutMs` is cancelled, so it
 * never goes out late without the session.
 */
export async function endTracking(timeoutMs = END_TIMEOUT_MS): Promise<void> {
  if (!enabled()) return;
  // Never more than FLUSH_AT wait: one request carries them all.
  const events = queue.splice(0, BATCH_MAX);
  stopTracking();
  if (!events.length) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,
      credentials: "same-origin",
      signal: controller.signal,
    });
  } catch {
    // Offline or cancelled: these few events are lost, the sign-out is not.
  } finally {
    clearTimeout(timeout);
  }
}

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush({ beacon: true });
  });
  window.addEventListener("pagehide", () => flush({ beacon: true }));
}
