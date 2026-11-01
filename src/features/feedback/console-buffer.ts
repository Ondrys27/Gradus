import { scrubMessage } from "@/lib/analytics/scrub";
import { REPORT_CONSOLE_LINE_MAX, REPORT_CONSOLE_MAX, type ConsoleEntry } from "./report";

/**
 * The last 20 errors of this tab's console, kept in memory for the "Report a
 * problem" dialog: console.error calls, errors the window saw and unhandled
 * promise rejections. Every line is scrubbed on entry the way analytics
 * scrubs an error message (no e-mails, no long numbers) and cut short; the
 * server does it once more. Nothing is stored or sent until a report is.
 */

const entries: ConsoleEntry[] = [];
let installed = false;

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function pushConsoleEntry(kind: ConsoleEntry["kind"], value: unknown, at = new Date()) {
  entries.push({
    at: at.toISOString(),
    kind,
    message: scrubMessage(describe(value)).slice(0, REPORT_CONSOLE_LINE_MAX),
  });
  if (entries.length > REPORT_CONSOLE_MAX) entries.splice(0, entries.length - REPORT_CONSOLE_MAX);
}

/** A copy of the buffer, oldest first. */
export function consoleEntries(): ConsoleEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export function clearConsoleEntries() {
  entries.length = 0;
}

/** Starts listening once per page load; safe to call again. */
export function installConsoleBuffer() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      pushConsoleEntry("console", args.map(describe).join(" "));
    } catch {
      // Keeping the buffer must never break logging.
    }
    original(...args);
  };
  window.addEventListener("error", (event) =>
    pushConsoleEntry("error", event.error ?? event.message),
  );
  window.addEventListener("unhandledrejection", (event) =>
    pushConsoleEntry("rejection", event.reason),
  );
}
