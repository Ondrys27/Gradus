"use client";

import { useGameState, useIsPlaying } from "@/features/game/queries";

/**
 * Which themes are open: in game mode only the unlocked ones (null while the
 * game state loads), in tool mode and for a worker all of them. What is
 * painted on <html> is kept by AppearanceSync (src/features/appearance).
 */
export function useThemeAccess(): { locked: boolean; unlocked: readonly string[] } | null {
  const playing = useIsPlaying();
  const game = useGameState();
  if (!playing) return { locked: false, unlocked: [] };
  if (!game.data) return null;
  return { locked: true, unlocked: game.data.unlocked };
}
