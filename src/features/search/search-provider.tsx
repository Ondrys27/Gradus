"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
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
  const setOpen = useCallback((next: boolean) => setOpenState(next), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSearchShortcut(event) || event.repeat) return;
      event.preventDefault();
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
