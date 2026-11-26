import { APP_VERSION } from "@/lib/app-version";
import {
  CLIENT_ERROR_ENDPOINT,
  type ClientErrorInput,
  type ClientErrorSource,
} from "./client-error";
import { isStaleClientError, noiseRuleOf } from "./noise";
import { errorText, scrubErrorMessage, scrubStack } from "./scrub";
import { reloadForNewVersion } from "./stale-client";

/** Records one page load sends at most; a loop of errors must not become a flood of requests. */
const MAX_PER_LOAD = 20;
/** The same window error again within this time is not sent again. */
const REPEAT_MS = 60_000;

/** Set by the first pagehide: errors of a page being left are its requests being cut. */
let leaving = false;
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    leaving = true;
  });
  window.addEventListener("pageshow", () => {
    leaving = false;
  });
}

const sentCodes = new Set<string>();
const lastSent = new Map<string, number>();
let sentCount = 0;

/** Only for the tests: forget what this tab sent. */
export function resetClientErrorRecords() {
  sentCodes.clear();
  lastSent.clear();
  sentCount = 0;
}

/** The record the browser sends for one caught error, scrubbed already. */
export function clientErrorRecord(
  error: unknown,
  source: ClientErrorSource,
  code: string,
  page: string,
): ClientErrorInput {
  const digest = (error as { digest?: unknown } | null)?.digest;
  const stack = scrubStack(error instanceof Error ? error.stack : undefined);
  const lang = typeof document !== "undefined" ? document.documentElement.lang : "";
  return {
    code,
    source,
    page,
    message: scrubErrorMessage(errorText(error)),
    ...(stack ? { stack } : {}),
    ...(typeof digest === "string" && /^[A-Za-z0-9_@-]{1,64}$/.test(digest) ? { digest } : {}),
    ...(typeof window !== "undefined"
      ? { viewport: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}` }
      : {}),
    ...(lang === "cs" || lang === "en" ? { locale: lang } : {}),
    ...(/^[A-Za-z0-9._-]{1,40}$/.test(APP_VERSION) ? { version: APP_VERSION } : {}),
  };
}

/**
 * Sends the record of an error to the server, which stores it and e-mails
 * the owner. Fire and forget (keepalive, so it survives the page going
 * away); never throws and never retries.
 */
export function sendClientErrorRecord(
  error: unknown,
  source: ClientErrorSource,
  code: string,
): void {
  try {
    if (sentCodes.has(code) || sentCount >= MAX_PER_LOAD) return;
    const raw = errorText(error);
    // An old page after a deployment: the new version, quietly, instead of a record.
    if (isStaleClientError(raw) && reloadForNewVersion()) return;
    const noise = noiseRuleOf({
      message: raw,
      stack: error instanceof Error ? error.stack : null,
      dev: process.env.NODE_ENV === "development",
      offline: typeof navigator !== "undefined" && navigator.onLine === false,
      leaving: leaving || document.visibilityState === "hidden",
    });
    // The stale page that reloaded a moment ago and fails again is a real error.
    if (noise && noise !== "staleClient") return;
    const record = clientErrorRecord(error, source, code, window.location.pathname);
    // The error page's code is shown to the person, so its record always goes;
    // window errors can repeat in a loop and are sent once a minute per message.
    const key = `${source}|${record.message}`;
    const now = Date.now();
    if (source !== "boundary" && (lastSent.get(key) ?? -Infinity) > now - REPEAT_MS) return;
    sentCodes.add(code);
    lastSent.set(key, now);
    sentCount += 1;
    void fetch(CLIENT_ERROR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify(record),
    }).catch(() => undefined);
  } catch {
    // Reporting an error must not cause another.
  }
}
