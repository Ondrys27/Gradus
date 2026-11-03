"use client";

import { useSyncExternalStore } from "react";
import { restoreItems, type OutboxItem } from "./outbox";

/**
 * The browser's outbox of Messages (see outbox.ts for the rules): the items
 * in localStorage under the signed-in account, the picked files and their
 * previews in memory only. The runner in ChatSync delivers them.
 */

const STORAGE_PREFIX = "gradus.chat.outbox.";
const EMPTY: OutboxItem[] = [];

let owner: string | null = null;
let items: OutboxItem[] = EMPTY;
const files = new Map<string, Blob>();
const previews = new Map<string, string>();
const listeners = new Set<() => void>();

function emit() {
  if (owner) {
    try {
      if (items.length) localStorage.setItem(STORAGE_PREFIX + owner, JSON.stringify(items));
      else localStorage.removeItem(STORAGE_PREFIX + owner);
    } catch {
      // Storage full or blocked: the outbox lives on in memory.
    }
  }
  listeners.forEach((listener) => listener());
}

/** Loads the account's outbox once per account (a reload restores what was waiting). */
export function openOutbox(userId: string) {
  if (owner === userId) return;
  owner = userId;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    items = raw ? restoreItems(JSON.parse(raw)) : EMPTY;
  } catch {
    items = EMPTY;
  }
  listeners.forEach((listener) => listener());
}

export function outboxItems(): OutboxItem[] {
  return items;
}

export function enqueue(item: OutboxItem, blobs: ReadonlyMap<string, Blob>) {
  for (const [id, blob] of blobs) {
    files.set(id, blob);
    if (blob.type.startsWith("image/")) previews.set(id, URL.createObjectURL(blob));
  }
  items = [...items, item];
  emit();
}

export function updateItem(id: string, patch: Partial<OutboxItem>) {
  items = items.map((item) => (item.id === id ? { ...item, ...patch } : item));
  emit();
}

export function removeItem(id: string) {
  const item = items.find((entry) => entry.id === id);
  for (const file of item?.files ?? []) {
    files.delete(file.id);
    const url = previews.get(file.id);
    if (url) {
      URL.revokeObjectURL(url);
      previews.delete(file.id);
    }
  }
  items = items.filter((entry) => entry.id !== id);
  emit();
}

/** A message not sent for good, tried once more now. */
export function retryItem(id: string) {
  updateItem(id, { failed: false, nextAt: 0, error: undefined });
}

export function fileBlob(id: string): Blob | undefined {
  return files.get(id);
}

/** The picture of a file still on its way (an object URL), for the bubble. */
export function filePreview(id: string): string | undefined {
  return previews.get(id);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(subscribe, outboxItems, () => EMPTY);
}
