import { inQuietHours } from "@/features/grady/proactive";

/**
 * When Grady offers help on his own (30.8): only from what the user does,
 * deterministically, never a guess of a model. Signs someone is lost in a
 * section: the same dialog opened and closed three times without saving,
 * two minutes on their first visit to a section without doing anything,
 * coming back to the same page again and again, three failed checks of a
 * form in a row. Then a bubble "Not sure how? Tell me what you need to do",
 * at most once per section and day, never with Grady switched off or
 * proactive messages off, in quiet hours, or after "don't offer again".
 */

export const DIALOG_REPEATS = 3;
export const FIRST_VISIT_IDLE_MS = 2 * 60_000;
export const RETURNS = 3;
export const RETURN_WINDOW_MS = 10 * 60_000;
export const FAILED_CHECKS = 3;

export type StruggleEvent =
  | { type: "dialogOpen"; id: string; at: number }
  | { type: "dialogClose"; id: string; at: number }
  /** The app saved something (a mutation succeeded): the user is getting on. */
  | { type: "saved"; at: number }
  /** A form refused what was typed (a field marked invalid, a failed save). */
  | { type: "invalid"; at: number }
  /** A page of the section was opened. */
  | { type: "visit"; path: string; at: number };

export type StruggleReason = "dialog" | "idle" | "returns" | "invalid";

/**
 * Whether the events of one section (oldest first) say the user is lost,
 * and why. A save wipes the slate: what came before it counts no more.
 */
export function struggleOf(input: {
  events: readonly StruggleEvent[];
  now: number;
  /** The first visit to this section ever. */
  firstVisit: boolean;
  /** When the user came into the section. */
  enteredAt: number;
}): StruggleReason | null {
  const lastSave = input.events.reduce((at, event) => (event.type === "saved" ? event.at : at), -1);
  const events = input.events.filter((event) => event.at > lastSave && event.type !== "saved");

  // The same dialog opened and closed without a save in between.
  const closes = new Map<string, number>();
  const open = new Set<string>();
  for (const event of events) {
    if (event.type === "dialogOpen") open.add(event.id);
    if (event.type === "dialogClose" && open.has(event.id)) {
      open.delete(event.id);
      const count = (closes.get(event.id) ?? 0) + 1;
      closes.set(event.id, count);
      if (count >= DIALOG_REPEATS) return "dialog";
    }
  }

  // Failed checks in a row (a save in between already reset them).
  let failed = 0;
  for (const event of events) if (event.type === "invalid") failed += 1;
  if (failed >= FAILED_CHECKS) return "invalid";

  // The same page again and again within a while.
  const visits = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "visit" || input.now - event.at > RETURN_WINDOW_MS) continue;
    const count = (visits.get(event.path) ?? 0) + 1;
    visits.set(event.path, count);
    if (count >= RETURNS) return "returns";
  }

  // The first time here and nothing done for two minutes.
  if (input.firstVisit && lastSave < input.enteredAt && input.now - input.enteredAt >= FIRST_VISIT_IDLE_MS) {
    return "idle";
  }
  return null;
}

/** Whether the bubble may show now. */
export function offerAllowed(input: {
  /** Grady on and his own messages on (Settings → Grady). */
  proactive: boolean;
  /** "Don't offer again". */
  offersOff: boolean;
  /** The day (in the user's zone) the offer was last shown in this section, if ever. */
  lastOfferDay: string | null;
  today: string;
  hour: number;
  quietFrom: number | null;
  quietTo: number | null;
  /** Something else is on screen: a tutorial, a dialog, Grady's panel, a running timer. */
  busy: boolean;
}): boolean {
  if (!input.proactive || input.offersOff || input.busy) return false;
  if (input.lastOfferDay === input.today) return false;
  return !inQuietHours(input.hour, input.quietFrom, input.quietTo);
}

/** Keeps the events of the last while only (and never too many). */
export function trimEvents<E extends StruggleEvent>(events: readonly E[], now: number, max = 60): E[] {
  return events.filter((event) => now - event.at <= RETURN_WINDOW_MS * 2).slice(-max);
}
