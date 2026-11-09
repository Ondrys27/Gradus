/** Enums the scheduler's analytics events use (src/lib/analytics/events.ts). */

/** The tabs of the meeting type editor. */
export const EVENT_TYPE_TABS = [
  "basics",
  "availability",
  "questions",
  "reminders",
  "confirmation",
  "preview",
] as const;
export type EventTypeTab = (typeof EVENT_TYPE_TABS)[number];

/** Where a booking link was copied from. */
export const LINK_SOURCES = ["card", "setup", "coldCalling", "email", "editor"] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];

/** Whose calendar a subscription is, read from the host of its link. */
export const CALENDAR_PROVIDERS = ["google", "apple", "outlook", "other"] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];

export function calendarProvider(host: string): CalendarProvider {
  const name = host.toLowerCase();
  if (name === "calendar.google.com" || name.endsWith(".google.com")) return "google";
  if (name.endsWith("icloud.com")) return "apple";
  if (name.endsWith("outlook.com") || name.endsWith("office365.com") || name.endsWith("live.com")) {
    return "outlook";
  }
  return "other";
}
