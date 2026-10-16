/**
 * Pure rules of the notes list: order, groups, search results and the trash.
 */

/** Days a deleted note stays in Recently Deleted before the daily cron removes it. */
export const TRASH_DAYS = 30;

type Sortable = { pinned: boolean; updated_at: string };

/** Pinned first, then the most recently edited (like Apple Notes). */
export function sortNotes<T extends Sortable>(notes: T[]): T[] {
  return [...notes].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

/** The list cut into Pinned and the rest; an empty group is left out. */
export function groupNotes<T extends Sortable>(notes: T[]): { pinned: T[]; others: T[] } {
  const sorted = sortNotes(notes);
  return {
    pinned: sorted.filter((note) => note.pinned),
    others: sorted.filter((note) => !note.pinned),
  };
}

/**
 * Notes of the list in the order the search ranked them; a hit missing from
 * the list (not loaded, or deleted meanwhile) is left out.
 */
export function orderBySearch<T extends { id: string }>(notes: T[], hitIds: string[]): T[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  return hitIds.map((id) => byId.get(id)).filter((note): note is T => !!note);
}

/** Whole days left before a note deleted at `deletedAt` goes for good (never below 0). */
export function daysLeftInTrash(deletedAt: string, now: Date = new Date()): number {
  const goneAt = new Date(deletedAt).getTime() + TRASH_DAYS * 24 * 3600 * 1000;
  return Math.max(0, Math.floor((goneAt - now.getTime()) / (24 * 3600 * 1000)));
}

/** The note to show after the selected one was deleted: the next one, or the previous. */
export function neighbourAfterRemoval<T extends { id: string }>(
  notes: T[],
  removedId: string,
): T | null {
  const index = notes.findIndex((note) => note.id === removedId);
  if (index < 0) return notes[0] ?? null;
  return notes[index + 1] ?? notes[index - 1] ?? null;
}
