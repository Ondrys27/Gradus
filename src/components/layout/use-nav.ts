"use client";

import { useMemo } from "react";
import { useSession } from "@/features/account/queries";
import { useWorkspace } from "@/features/account/workspace-queries";
import { useLocale } from "next-intl";
import { useGameState } from "@/features/game/queries";
import { isLockableSection, localized, SECTION_UNLOCK_KEYS } from "@/features/game/types";
import { bottomNavKeysFor, navItemsFor, type NavItem, type WorkerNavAccess } from "./nav-items";

/** What opens a locked section: a milestone of the path (by its title) or a level. */
export type LockHint =
  | { kind: "milestone"; title: string; milestoneId: string | null }
  | { kind: "level"; level: number }
  | { kind: "path" };

export type NavItemState = NavItem & {
  /** Not yet earned: dimmed, with a lock icon and what unlocks it. */
  locked: boolean;
  /** Unlocked but not opened yet: glows in the sidebar until the section is visited. */
  fresh: boolean;
  lockHint: LockHint | null;
};

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
 * Only an owner in game mode ever sees a lock; tool mode opens everything and
 * a worker's access is entirely decided by what the owner already granted.
 */
export function useNavItems() {
  const access = useNavAccess();
  const { worker } = useSession();
  const game = useGameState();
  const locale = useLocale();

  return useMemo(() => {
    const items = navItemsFor(access);
    const bottomKeys = bottomNavKeysFor(access);
    const playing = game.data?.mode === "game";
    const withState: NavItemState[] = items.map((item) => {
      const unlockKey =
        !worker && playing && isLockableSection(item.key) ? SECTION_UNLOCK_KEYS[item.key] : null;
      const section = unlockKey
        ? game.data?.sections.find((row) => row.key === unlockKey)
        : undefined;
      // Unknown while loading reads as unlocked, matching the app's rule that
      // page chrome never waits on a network read.
      if (!section) return { ...item, locked: false, fresh: false, lockHint: null };
      const title = section.milestone?.title ?? localized(section.templateTitle, locale);
      const lockHint: LockHint = title
        ? { kind: "milestone", title, milestoneId: section.milestone?.id ?? null }
        : section.level
          ? { kind: "level", level: section.level }
          : { kind: "path" };
      return {
        ...item,
        locked: !section.unlocked,
        fresh: section.unlocked && !!section.unlockedAt && !section.seenAt,
        lockHint: section.unlocked ? null : lockHint,
      };
    });
    return {
      items: withState,
      primary: withState.filter((item) => bottomKeys.includes(item.key)),
      more: withState.filter((item) => !bottomKeys.includes(item.key)),
    };
  }, [access, worker, game.data, locale]);
}
