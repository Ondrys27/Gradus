"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sameItems, type LayoutItem } from "./grid";

/** Changes are saved this long after the last one, so dragging writes once. */
const SAVE_DELAY_MS = 700;
/** Steps ⌘Z can go back within one visit. */
const HISTORY_LIMIT = 50;

/**
 * The working copy of one dashboard while it is shown (28.5): every change is
 * on screen at once, saved on its own a moment later (no Save button), and
 * ⌘Z / Ctrl+Z takes back the last one. While nothing was changed here, a
 * newer layout from the server (another device, the company's default) simply
 * replaces the copy.
 */
export function useBoardEditor({
  source,
  save,
  boardKey,
}: {
  /** What the server says the layout is; undefined while loading. */
  source: LayoutItem[] | undefined;
  save: (items: LayoutItem[]) => Promise<unknown>;
  /** Another dashboard (tab or target) starts a fresh copy and history. */
  boardKey: string;
}) {
  const [items, setItems] = useState<LayoutItem[] | undefined>(source);
  const [history, setHistory] = useState<LayoutItem[][]>([]);
  const [saving, setSaving] = useState<"idle" | "pending" | "failed">("idle");
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  /** What is on screen now (state lags a render behind). */
  const shown = useRef<LayoutItem[] | undefined>(source);
  /** What is to be saved: the screen, except while a drag is only previewed. */
  const latest = useRef<LayoutItem[] | undefined>(source);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const [seenKey, setSeenKey] = useState(boardKey);
  const [seenSource, setSeenSource] = useState(source);

  // A different board, or a newer layout from the server while nothing is unsaved.
  if (boardKey !== seenKey) {
    setSeenKey(boardKey);
    setSeenSource(source);
    setItems(source);
    setHistory([]);
    dirty.current = false;
    shown.current = source;
    latest.current = source;
  } else if (source !== seenSource) {
    setSeenSource(source);
    if (!dirty.current && source && !(items && sameItems(items, source))) {
      setItems(source);
      shown.current = source;
      latest.current = source;
    }
  }

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const next = latest.current;
    if (!dirty.current || !next) return;
    setSaving("pending");
    try {
      await saveRef.current(next);
      if (latest.current === next) dirty.current = false;
      setSaving("idle");
    } catch (error) {
      console.error("[dashboard] could not save the layout", error);
      setSaving("failed");
    }
  }, []);

  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  const store = useCallback(
    (next: LayoutItem[]) => {
      setItems(next);
      shown.current = next;
      latest.current = next;
      dirty.current = true;
      schedule();
    },
    [schedule],
  );

  const remember = useCallback((before: LayoutItem[] | undefined) => {
    if (before) setHistory((steps) => [...steps.slice(-(HISTORY_LIMIT - 1)), before]);
  }, []);

  /** A change the user made: on screen now, saved soon, one step of ⌘Z. */
  const apply = useCallback(
    (next: LayoutItem[]) => {
      remember(shown.current);
      store(next);
    },
    [remember, store],
  );

  /** A step only on screen (a drag in progress); `commit` saves it as one step. */
  const preview = useCallback((next: LayoutItem[]) => {
    setItems(next);
    shown.current = next;
  }, []);

  const commit = useCallback(
    (before: LayoutItem[], next: LayoutItem[]) => {
      if (sameItems(before, next)) {
        setItems(before);
        shown.current = before;
        return;
      }
      remember(before);
      store(next);
    },
    [remember, store],
  );

  const undo = useCallback(() => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(history.slice(0, -1));
    store(previous);
  }, [history, store]);

  // Unsaved changes go out when the board is left or the page hides.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush, boardKey]);

  return {
    items,
    apply,
    preview,
    commit,
    undo,
    canUndo: history.length > 0,
    saving,
    retry: flush,
  };
}

/** ⌘Z / Ctrl+Z outside a text field. */
export function useUndoShortcut(enabled: boolean, undo: () => void) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== "z")
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, undo]);
}
