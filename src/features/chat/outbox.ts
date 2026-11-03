/**
 * Messages on their way. A message shows at once (optimistic), its files go
 * up first, then the server gets it under the id made here, so sending the
 * same message again after a lost answer never doubles it. When the network
 * is gone it waits and tries again (after 2, 5, 15, 30, then every 60 s, at
 * once when the browser is back online); a message the server refuses for
 * good stays as "not sent" with Try again / Delete. Messages without files
 * are kept in localStorage, so a reload or a closed tab loses nothing.
 */

export type OutboxFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  uploaded: boolean;
};

export type OutboxItem = {
  id: string;
  /** Whose space. */
  space: string;
  channelId: string | null;
  /** A direct conversation made by this message. */
  to: string | null;
  body: string;
  replyTo: string | null;
  files: OutboxFile[];
  createdAt: string;
  attempts: number;
  /** When to try again (ms since epoch); 0 = now. */
  nextAt: number;
  /** Refused for good (or its files are gone after a reload): waits for the person. */
  failed: boolean;
  error?: string;
};

const DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

/** How long to wait before the next attempt after `attempts` failed ones. */
export function retryDelay(attempts: number): number {
  return DELAYS_MS[Math.min(Math.max(attempts - 1, 0), DELAYS_MS.length - 1)]!;
}

/** Answers that will not change by trying again; a network error, 408, 429 and 5xx will. */
export function isPermanentFailure(status: number | null): boolean {
  if (status === null) return false;
  if (status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

/** The item after a failed attempt. */
export function afterFailure(
  item: OutboxItem,
  status: number | null,
  error: string | undefined,
  now: number,
): OutboxItem {
  const attempts = item.attempts + 1;
  if (isPermanentFailure(status)) return { ...item, attempts, failed: true, error };
  return { ...item, attempts, nextAt: now + retryDelay(attempts), failed: false, error };
}

/** Items to try now: not failed for good and due. */
export function dueItems(items: readonly OutboxItem[], now: number): OutboxItem[] {
  return items.filter((item) => !item.failed && item.nextAt <= now);
}

/**
 * What survives a reload: everything whose files are up (or has none); an
 * item that still had a file to upload cannot finish without it and is
 * marked as not sent.
 */
export function restoreItems(raw: unknown): OutboxItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value): OutboxItem[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as OutboxItem;
    if (typeof item.id !== "string" || typeof item.space !== "string") return [];
    if (typeof item.body !== "string" || !Array.isArray(item.files)) return [];
    const lost = item.files.some((file) => !file.uploaded);
    return [{ ...item, nextAt: 0, failed: item.failed || lost, error: lost ? "fileMissing" : item.error }];
  });
}
