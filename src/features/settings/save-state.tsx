"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircleIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useUpdateSettings } from "@/features/account/queries";
import type { UserSettingsPatch } from "@/lib/user-settings";
import { cn } from "@/lib/utils";

export type SaveState = "saving" | "saved" | "failed";

/** How long "Saved" stays next to a field. */
const SAVED_VISIBLE_MS = 2500;

/**
 * Per-field save states: a field says which keys it owns and gets back
 * "saving", "saved" or "failed" for the last save that touched them. Used by
 * the settings (one provider for `user_settings`) and by fields with their
 * own mutation (the profile), so every "Saved" looks the same.
 */
export function useSaveMarks() {
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const mark = useCallback((keys: readonly string[], state: SaveState) => {
    setStates((previous) => {
      const next = { ...previous };
      for (const key of keys) next[key] = state;
      return next;
    });
    for (const key of keys) {
      const previous = timers.current.get(key);
      if (previous) window.clearTimeout(previous);
      if (state === "saved") {
        timers.current.set(
          key,
          window.setTimeout(() => {
            setStates((current) => {
              if (current[key] !== "saved") return current;
              const next = { ...current };
              delete next[key];
              return next;
            });
            timers.current.delete(key);
          }, SAVED_VISIBLE_MS),
        );
      }
    }
  }, []);

  /** Runs a save for these keys and keeps their state in step with it. */
  const run = useCallback(
    async (keys: readonly string[], save: () => Promise<unknown>) => {
      mark(keys, "saving");
      try {
        await save();
        mark(keys, "saved");
        return true;
      } catch {
        mark(keys, "failed");
        return false;
      }
    },
    [mark],
  );

  const stateOf = useCallback(
    (keys: readonly string[]): SaveState | null => {
      let result: SaveState | null = null;
      for (const key of keys) {
        const state = states[key];
        if (state === "failed") return "failed";
        if (state === "saving") result = "saving";
        else if (state === "saved" && result === null) result = "saved";
      }
      return result;
    },
    [states],
  );

  return useMemo(() => ({ run, stateOf }), [run, stateOf]);
}

type SettingsSave = {
  /** Saves a patch of `user_settings` right away; the fields it touches show the outcome. */
  save: (patch: UserSettingsPatch) => void;
  stateOf: (keys: readonly string[]) => SaveState | null;
};

const SettingsSaveContext = createContext<SettingsSave | null>(null);

export function SettingsSaveProvider({ children }: { children: ReactNode }) {
  const update = useUpdateSettings();
  const marks = useSaveMarks();
  const mutateAsync = update.mutateAsync;
  const save = useCallback(
    (patch: UserSettingsPatch) => {
      void marks.run(Object.keys(patch), () => mutateAsync(patch));
    },
    [marks, mutateAsync],
  );
  const value = useMemo(() => ({ save, stateOf: marks.stateOf }), [save, marks.stateOf]);
  return <SettingsSaveContext.Provider value={value}>{children}</SettingsSaveContext.Provider>;
}

export function useSettingsSave(): SettingsSave {
  const context = useContext(SettingsSaveContext);
  if (!context) throw new Error("useSettingsSave needs SettingsSaveProvider");
  return context;
}

/** The same, or null outside the settings (shared rows render there too). */
export function useSettingsSaveMaybe(): SettingsSave | null {
  return useContext(SettingsSaveContext);
}

/** The small, quiet outcome of a save next to the field it belongs to. */
export function SaveMark({ state, className }: { state: SaveState | null; className?: string }) {
  const t = useTranslations("settings.status");
  return (
    <span
      role="status"
      className={cn(
        "inline-flex min-h-5 items-center gap-1 text-xs transition-opacity motion-reduce:transition-none",
        state ? "opacity-100" : "opacity-0",
        state === "failed" ? "text-pink" : state === "saved" ? "text-green" : "text-ink-muted",
        className,
      )}
    >
      {state === "saving" && (
        <>
          <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
          {t("saving")}
        </>
      )}
      {state === "saved" && (
        <>
          <CheckIcon aria-hidden className="size-3.5" />
          {t("saved")}
        </>
      )}
      {state === "failed" && (
        <>
          <AlertCircleIcon aria-hidden className="size-3.5" />
          {t("failed")}
        </>
      )}
    </span>
  );
}
