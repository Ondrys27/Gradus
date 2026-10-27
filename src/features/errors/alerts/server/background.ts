import "server-only";
import { after } from "next/server";

type WaitUntil = (promise: Promise<unknown>) => void;

/** Vercel's (and Next.js's own) request context outside the `after` scope. */
function builtinWaitUntil(): WaitUntil | null {
  const holder = (
    globalThis as Record<symbol, { get?: () => { waitUntil?: WaitUntil } } | undefined>
  )[Symbol.for("@next/request-context")];
  const waitUntil = holder?.get?.()?.waitUntil;
  return typeof waitUntil === "function" ? waitUntil : null;
}

/**
 * Runs work the response must not wait for: it starts now, the response goes
 * out without it, and the platform keeps the function alive until it ends
 * (`after`, else the request context's waitUntil). It never throws; a failure
 * is only logged under `label`.
 */
export function runInBackground(label: string, task: () => Promise<unknown>): void {
  const promise = (async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[${label}] failed`, error instanceof Error ? error.message : "unknown");
    }
  })();
  try {
    after(promise);
    return;
  } catch {
    // Outside a request scope (instrumentation, scripts).
  }
  try {
    builtinWaitUntil()?.(promise);
  } catch {
    // Nothing keeps it alive; it still runs while the process does.
  }
}
