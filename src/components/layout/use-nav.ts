"use client";

import { useMemo } from "react";
import { useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { SECTION_UNLOCK_KEYS, type LockableSection } from "@/features/gamification/types";
import { useSectionUnlocks } from "@/features/gamification/queries";
import { bottomNavKeysFor, navItemsFor, type NavItem, type WorkerNavAccess } from "./nav-items";

export type NavItemState = NavItem & {
  /** Not yet earned: dimmed, with a lock icon and what is left to unlock it. */
  locked: boolean;
  /** Unlocked but not opened yet: glows in the sidebar until the section is visited. */
  fresh: boolean;
  progress: number;
  needed: number;
};

function isLockable(key: string): key is LockableSection {
  return key in SECTION_UNLOCK_KEYS;
}

/** What the signed-in account may open; a worker's rights are live, so a change shows at once. */
export function useNavAccess(): WorkerNavAccess {
  const workspace = useWorkspace();
  return useMemo(
    () => (workspace.role === "worker" ? { permissions: workspace.permissions } : null),
    [workspace],
  );
}

/**
 * The sidebar and the phone bar of this account, with lock state merged in.
 * Only an owner's own four gated sections ever lock; a worker's access is
 * entirely decided by what the owner already granted them.
 */
export function useNavItems() {
  const access = useNavAccess();
  const { worker } = useSession();
  const unlocks = useSectionUnlocks();

  return useMemo(() => {
    const items = navItemsFor(access);
    const bottomKeys = bottomNavKeysFor(access);
    const withState: NavItemState[] = items.map((item) => {
      if (worker || !isLockable(item.key)) {
        return { ...item, locked: false, fresh: false, progress: 0, needed: 0 };
      }
      const row = unlocks.data?.[item.key];
      return {
        ...item,
        // Unknown while loading reads as unlocked, matching the app's rule that
        // page chrome never waits on a network read.
        locked: row ? !row.unlocked : false,
        fresh: row ? row.unlocked && !row.seen_at : false,
        progress: row?.progress ?? 0,
        needed: row?.needed ?? 1,
      };
    });
    return {
      items: withState,
      primary: withState.filter((item) => bottomKeys.includes(item.key)),
      more: withState.filter((item) => !bottomKeys.includes(item.key)),
    };
  }, [access, worker, unlocks.data]);
}
