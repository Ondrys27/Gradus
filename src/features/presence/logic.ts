import type { PresenceStatus } from "@/components/ui/presence";

/**
 * Online status in the company (30.5), the rules without React or Realtime.
 *
 * Each open tab is present on the private channel `presence:<space>` of every
 * company its account belongs to, under the account id, with one flag: idle
 * (10 minutes without a touch, mouse, key or scroll). All tabs and devices of
 * one account are one status, the best of them. What stays in the database
 * is only when the account last had the app open, written at most once a
 * minute and when leaving.
 */

/** Without a touch for this long the person is away. */
export const PRESENCE_IDLE_MS = 10 * 60_000;
/** The last moment is written at most this often while the app is in front of the person. */
export const PRESENCE_TOUCH_MS = 60_000;
/** A busy company has a handful of companies per account; this only bounds the channels of a tab. */
export const PRESENCE_MAX_CHANNELS = 10;

export const presenceTopic = (space: string) => `presence:${space}`;

/** What one tab says about itself on the channel. */
export type PresenceMeta = { idle: boolean };

export type PresencePerson = { spaceId: string; userId: string; lastSeenAt: string | null };

/** The best of all tabs and devices: one in use = online, any open = away, none = offline. */
export function bestStatus(metas: readonly unknown[] | undefined): PresenceStatus {
  if (!metas || metas.length === 0) return "offline";
  const active = metas.some(
    (meta) => !!meta && typeof meta === "object" && (meta as { idle?: unknown }).idle === false,
  );
  return active ? "online" : "away";
}

/** The status of every account present on a channel (its presence state is keyed by account id). */
export function statusesOf(state: Record<string, readonly unknown[]>): Map<string, PresenceStatus> {
  const statuses = new Map<string, PresenceStatus>();
  for (const [key, metas] of Object.entries(state)) {
    const status = bestStatus(metas);
    if (status !== "offline") statuses.set(key, status);
  }
  return statuses;
}

/**
 * The companies whose channel a tab joins: those where someone else shows
 * their status too (alone, nobody would see the dot). Ordered, so the same
 * people give the same list.
 */
export function channelSpaces(people: readonly PresencePerson[], me: string): string[] {
  const shared = new Set<string>();
  for (const person of people) if (person.userId !== me) shared.add(person.spaceId);
  return [...shared].sort().slice(0, PRESENCE_MAX_CHANNELS);
}

/**
 * The status of one account as the viewer sees it in the active company: only
 * people the database lists for that company (a channel entry of anybody
 * else is ignored), only when the company's channel is joined.
 */
export function presenceIn(
  people: readonly PresencePerson[],
  statuses: ReadonlyMap<string, PresenceStatus> | undefined,
  space: string,
  userId: string,
): { status: PresenceStatus; lastSeenAt: string | null } | null {
  if (!statuses) return null;
  const person = people.find((row) => row.spaceId === space && row.userId === userId);
  if (!person) return null;
  const status = statuses.get(userId) ?? "offline";
  return { status, lastSeenAt: status === "offline" ? person.lastSeenAt : null };
}

/** Whether a tab with this last touch is idle now. */
export function isIdle(
  lastActivity: number,
  now: number,
  idleMs: number = PRESENCE_IDLE_MS,
): boolean {
  return now - lastActivity >= idleMs;
}

/**
 * The idle limit of this browser: 10 minutes; end-to-end tests outside
 * production shorten it through localStorage so they need not wait.
 */
export function presenceIdleMs(): number {
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    try {
      const value = Number(window.localStorage.getItem("gradus.e2e.presenceIdleMs"));
      if (Number.isFinite(value) && value >= 1_000) return value;
    } catch {
      // Storage refused: the normal limit.
    }
  }
  return PRESENCE_IDLE_MS;
}
