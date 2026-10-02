"use client";

import { useEffect } from "react";
import { useUserSettings } from "@/features/account/queries";
import { useGameState, useIsPlaying } from "@/features/game/queries";
import { effectiveTheme, writeThemeCookie } from "@/lib/themes";

/**
 * Which themes are open: in game mode only the unlocked ones (null while the
 * game state loads), in tool mode and for a worker all of them.
 */
export function useThemeAccess(): { locked: boolean; unlocked: readonly string[] } | null {
  const playing = useIsPlaying();
  const game = useGameState();
  if (!playing) return { locked: false, unlocked: [] };
  if (!game.data) return null;
  return { locked: true, unlocked: game.data.unlocked };
}

/**
 * Keeps <html data-theme> on the theme the user picked, or the default when
 * the pick is locked (a switch back to game mode). Remembers it in a cookie,
 * so the next server render paints the right colours from the start.
 */
export function ThemeSync() {
  const settings = useUserSettings();
  const access = useThemeAccess();
  const theme = access ? effectiveTheme(settings.theme, access) : null;

  useEffect(() => {
    if (!theme) return;
    if (document.documentElement.dataset.theme !== theme) {
      document.documentElement.dataset.theme = theme;
    }
    writeThemeCookie(theme);
  }, [theme]);

  return null;
}
