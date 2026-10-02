"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/features/account/queries";
import { useGameState, useMarkUnlockSeen } from "./queries";
import { SECTION_UNLOCK_KEYS, type LockableSection } from "./types";

/**
 * Clears a section's "just unlocked" glow the first time its page is opened.
 * Renders nothing; drop it once near the top of an unlockable section's view.
 * A worker has no unlock progression of their own, so this is a no-op for them.
 */
export function MarkSeenOnVisit({ section }: { section: LockableSection }) {
  const { worker } = useSession();
  const game = useGameState();
  const markSeen = useMarkUnlockSeen();
  const done = useRef(false);

  const key = SECTION_UNLOCK_KEYS[section];
  const row = game.data?.sections.find((item) => item.key === key);
  const fresh = game.data?.mode === "game" && !!row?.unlockedAt && !row.seenAt;
  useEffect(() => {
    if (worker || done.current || !fresh) return;
    done.current = true;
    markSeen.mutate(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the unlock state should retrigger this
  }, [fresh, key, worker]);

  return null;
}
