import type { ProviderKey } from "./types";

/** What Settings → Calendar shows of two-way sync (GET /api/integrations/calendar). */
export type CalendarSyncOverview = {
  /** The switch lets this account in. */
  allowed: boolean;
  /** This server has the key for secrets. */
  available: boolean;
  /** This server has Google's OAuth client. */
  google: boolean;
  connections: SyncConnection[];
};

export type SyncConnection = {
  id: string;
  provider: ProviderKey;
  accountLabel: string | null;
  status: "active" | "error";
  lastError: string | null;
  lastSyncedAt: string | null;
  calendars: SyncCalendarView[];
};

export type SyncCalendarView = {
  id: string;
  name: string;
  isPrimary: boolean;
  canWrite: boolean;
  read: boolean;
  write: boolean;
  syncedAt: string | null;
  lastError: string | null;
};

/** Which card a provider gets in Settings: connect, connected, or "not yet". */
export type ProviderCardState = "unavailable" | "notAllowed" | "connect" | "connected" | "broken";

export function providerCardState(overview: CalendarSyncOverview, provider: ProviderKey): ProviderCardState {
  const connection = overview.connections.find((item) => item.provider === provider);
  if (connection) return connection.status === "error" ? "broken" : "connected";
  if (!overview.allowed) return "notAllowed";
  if (!overview.available || (provider === "google" && !overview.google)) return "unavailable";
  return "connect";
}

/** Saving the choice: the write calendar is always read too, and must allow writing. */
export function normalizeSelection(
  calendars: Pick<SyncCalendarView, "id" | "canWrite">[],
  read: string[],
  write: string | null,
): { read: string[]; write: string | null } {
  const ids = new Set(calendars.map((calendar) => calendar.id));
  const writable = new Set(calendars.filter((calendar) => calendar.canWrite).map((calendar) => calendar.id));
  const chosenWrite = write && writable.has(write) ? write : null;
  const chosenRead = new Set(read.filter((id) => ids.has(id)));
  if (chosenWrite) chosenRead.add(chosenWrite);
  return { read: [...chosenRead], write: chosenWrite };
}
