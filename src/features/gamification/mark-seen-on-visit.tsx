"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/features/account/queries";
import { useMarkSectionSeen, useSectionUnlocks } from "./queries";
import { SECTION_UNLOCK_KEYS, type LockableSection } from "./types";

/**
 * Clears a section's "just unlocked" glow the first time its page is opened.
 * Renders nothing; drop it once near the top of an unlockable section's view.
 * A worker has no unlock progression of their own, so this is a no-op for them.
 */
export function MarkSeenOnVisit({ section }: { section: LockableSection }) {
  const { worker } = useSession();
  const unlocks = useSectionUnlocks();
  const markSeen = useMarkSectionSeen();
  const done = useRef(false);

  const row = unlocks.data?.[section];
  useEffect(() => {
    if (worker || done.current || !row || !row.unlocked || row.seen_at) return;
    done.current = true;
    markSeen.mutate(SECTION_UNLOCK_KEYS[section]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the unlock row should retrigger this
  }, [row, section, worker]);

  return null;
}
