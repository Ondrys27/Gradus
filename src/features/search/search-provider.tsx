"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { track } from "@/lib/analytics/client";
import { SearchPalette } from "./search-palette";

type SearchContextValue = { open: boolean; setOpen: (open: boolean) => void };

const SearchContext = createContext<SearchContextValue | null>(null);

export function useSearchPalette(): SearchContextValue {
  const value = useContext(SearchContext);
  if (!value) throw new Error("useSearchPalette must be used inside <SearchProvider>");
  return value;
}

/** ⌘K on a Mac, Ctrl+K elsewhere, from anywhere in the app. */
export function isSearchShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
) {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k"
  );
}

/** Holds the search window's open state and listens for the shortcut. */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  // Opening by a click (the triggers call this); closing is not an event.
  const setOpen = useCallback((next: boolean) => {
    if (next && !openRef.current) track("search_opened", { via: "click" });
    setOpenState(next);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSearchShortcut(event) || event.repeat) return;
      event.preventDefault();
      if (!openRef.current) track("search_opened", { via: "shortcut" });
      setOpenState((current) => !current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(() => ({ open, setOpen }), [open, setOpen]);
  return (
    <SearchContext.Provider value={value}>
      {children}
      <SearchPalette open={open} onOpenChange={setOpen} />
    </SearchContext.Provider>
  );
}
