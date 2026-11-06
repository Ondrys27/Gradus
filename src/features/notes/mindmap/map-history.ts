/**
 * Undo and redo of a map for the time it is open (⌘Z / ⌘⇧Z): every change is
 * one step. Leaving the note forgets the steps; the map itself is saved.
 */
import type { MapDoc } from "./map-doc";

export const HISTORY_LIMIT = 100;

export type MapHistory = { past: MapDoc[]; present: MapDoc; future: MapDoc[] };

export function startHistory(doc: MapDoc): MapHistory {
  return { past: [], present: doc, future: [] };
}

/** A new state; the same object again is no step. Redo is gone after a change. */
export function pushHistory(history: MapHistory, doc: MapDoc): MapHistory {
  if (doc === history.present) return history;
  const past = [...history.past, history.present];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: doc, future: [] };
}

export function undoHistory(history: MapHistory): MapHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoHistory(history: MapHistory): MapHistory {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}

export const canUndo = (history: MapHistory) => history.past.length > 0;
export const canRedo = (history: MapHistory) => history.future.length > 0;

type KeyLike = {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** ⌘Z / Ctrl+Z = undo, ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y = redo. */
export function historyKeyOf(event: KeyLike): "undo" | "redo" | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  const isZ = key === "z" || event.code === "KeyZ";
  if (isZ) return event.shiftKey ? "redo" : "undo";
  if ((key === "y" || event.code === "KeyY") && !event.shiftKey && event.ctrlKey) return "redo";
  return null;
}
