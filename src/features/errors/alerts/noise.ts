/**
 * Errors that are not the app's fault and are not recorded (30.1): every
 * rule in one place, each with the reason it is safe, so that none of them
 * hides a real error. The browser checks them before it sends a record
 * (send-client-error.ts), the server before it stores one (capture.ts and
 * POST /api/client-error, for browsers still on an older version).
 *
 * Kept deliberately narrow, matched on the whole message and, where it
 * matters, on where it happened:
 *   * an aborted request or fetch: the person left the page or the tab
 *     cancelled what it no longer needed;
 *   * a lost connection, but only when the browser knows it is offline or
 *     the page is going away (and on the dev server, which restarts under
 *     the tests); otherwise "Connection closed." may be a server cut off by
 *     its time limit, and is recorded;
 *   * a browser extension's own error (its script is the top frame);
 *   * the browser's harmless ResizeObserver notice and foreign "Script error.";
 *   * an old page after a deployment asking for code that is gone (a chunk,
 *     a server action): the browser reloads itself instead (stale-client.ts);
 *   * a bot's malformed address;
 *   * only on the dev server: the bundler's own failures (Turbopack's client
 *     manifest, module instances after a hot update), never in production.
 *
 * noise.test.ts holds a real error next to each rule that must still pass.
 */

export const NOISE_RULES = [
  "abortedRequest",
  "connectionLost",
  "browserExtension",
  "browserNotice",
  "staleClient",
  "malformedAddress",
  "devBundler",
] as const;
export type NoiseRule = (typeof NOISE_RULES)[number];

export type NoiseInput = {
  /** "Name: message", as errorText() writes it (scrubbed or not: the rules match both). */
  message: string;
  stack?: string | null;
  /** Running on `next dev` (NODE_ENV development), the shared database's other writer. */
  dev: boolean;
  /** The browser said it is offline (navigator.onLine false); unknown on the server. */
  offline?: boolean;
  /** The page is being left or hidden (pagehide, visibility hidden); unknown on the server. */
  leaving?: boolean;
};

/** The person or the tab cancelled it: Node's abortIncoming, fetch's AbortError and friends. */
const ABORTED =
  /^(?:Error: aborted|AbortError: .*|Error: The operation was aborted\.?|Error: This operation was aborted|Error: signal is aborted without reason|TypeError: The user aborted a request\.?|ResponseAborted: .*)$/;

/** The network went away mid-request, in each browser's words. */
const CONNECTION =
  /^(?:Error: Connection closed\.|TypeError: Failed to fetch|TypeError: Load failed|TypeError: NetworkError when attempting to fetch resource\.|TypeError: network error|TypeError: cancelled|TypeError: The network connection was lost\.)$/;

/** Code of the previous deployment that is no longer there. */
const STALE =
  /^(?:ChunkLoadError: .*|Error: Loading chunk \S+ failed.*|Error: Loading CSS chunk \S+ failed.*|TypeError: Failed to fetch dynamically imported module.*|TypeError: Importing a module script failed\.?|TypeError: error loading dynamically imported module.*|Error: Failed to find Server Action .*)$/;

const BROWSER_NOTICE =
  /^(?:Error: )?(?:ResizeObserver loop completed with undelivered notifications\.?|ResizeObserver loop limit exceeded|Script error\.?)$/;

const MALFORMED = /^(?:URIError: URI malformed|URIError: URI error|Error: Failed to decode param .*|Error: Invalid Server Actions request\.?)$/;

/** Turbopack's dev runtime losing track of its own modules (seen only on `next dev`). */
const DEV_BUNDLER =
  /in the React Client Manifest|was instantiated because it was required from module|`NextIntlClientProvider` was not found/;

const EXTENSION_FRAME = /(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//;

/** The first frame of a stack: the code that threw. */
function topFrame(stack: string | null | undefined): string {
  return (
    (stack ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^at\s|@|:\d+:\d+/.test(line)) ?? ""
  );
}

/** Which rule makes this error noise, or null: a real error, to be recorded. */
export function noiseRuleOf(input: NoiseInput): NoiseRule | null {
  const message = input.message.trim();
  if (ABORTED.test(message)) return "abortedRequest";
  if (CONNECTION.test(message) && (input.offline || input.leaving || input.dev)) {
    return "connectionLost";
  }
  if (EXTENSION_FRAME.test(topFrame(input.stack))) return "browserExtension";
  if (BROWSER_NOTICE.test(message)) return "browserNotice";
  if (isStaleClientError(message)) return "staleClient";
  if (MALFORMED.test(message)) return "malformedAddress";
  if (input.dev && DEV_BUNDLER.test(message)) return "devBundler";
  return null;
}

/** An old page after a deployment: its next step is a reload, not a record. */
export function isStaleClientError(message: string): boolean {
  return STALE.test(message.trim());
}
