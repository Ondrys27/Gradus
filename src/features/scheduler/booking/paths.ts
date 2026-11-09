import { SCHEDULER_PATH } from "../types";

/** Where the host handles one booking in the app (the e-mail, Jarvis, the dashboard). */
export function bookingAppPath(bookingId: string): string {
  return `${SCHEDULER_PATH}?tab=bookings&booking=${bookingId}`;
}
