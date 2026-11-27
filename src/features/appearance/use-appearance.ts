"use client";

import { useCallback, useMemo } from "react";
import { useThemeAccess } from "@/features/settings/theme";
import { DEFAULT_THEME, isThemeAvailable, type ThemeKey } from "@/lib/themes";
import { builtinView, customView, type AppearanceView } from "./custom-tokens";
import { useCustomThemes, type CustomTheme } from "./queries";
import { parseThemeRef, type ThemeRef } from "./theme-ref";

export type ThemeAccess = { locked: boolean; unlocked: readonly string[] };

/**
 * A ref as what to paint: a built-in theme game mode keeps locked falls back
 * to the default, a custom theme that is gone too. Null while the game state
 * or the custom themes are still loading (nothing is repainted then).
 */
export function viewForRef(
  ref: ThemeRef,
  access: ThemeAccess | null,
  customs: readonly CustomTheme[] | undefined,
): AppearanceView | null {
  const parsed = parseThemeRef(ref);
  if (parsed?.kind === "custom") {
    if (!customs) return null;
    const theme = customs.find((item) => item.id === parsed.id);
    return theme ? customView(theme.tokens) : builtinView(DEFAULT_THEME);
  }
  const key: ThemeKey = parsed?.kind === "builtin" ? parsed.key : DEFAULT_THEME;
  if (key === DEFAULT_THEME) return builtinView(key);
  if (!access) return null;
  return builtinView(isThemeAvailable(key, access) ? key : DEFAULT_THEME);
}

/** viewForRef with the signed-in account's access and custom themes. */
export function useViewFor() {
  const access = useThemeAccess();
  const customs = useCustomThemes().data;
  const viewFor = useCallback((ref: ThemeRef) => viewForRef(ref, access, customs), [access, customs]);
  // A stable key of the inputs, for effects that repaint when they change.
  const key = useMemo(
    () => JSON.stringify([access, customs?.map((theme) => [theme.id, theme.updatedAt])]),
    [access, customs],
  );
  return { viewFor, access, customs, key };
}
