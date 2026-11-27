"use client";

import { useMemo } from "react";
import { useSession } from "@/features/account/queries";
import { canDo } from "@/features/account/workspace";
import { grantAllows } from "@/features/workers/permissions-catalog";
import { useWorkspace } from "@/features/account/workspace-queries";
import { useLocale } from "next-intl";
import { useChatUnread } from "@/features/chat/queries";
import { useGameState } from "@/features/game/queries";
import { localized, lockSectionOf, SECTION_UNLOCK_KEYS } from "@/features/game/types";
import { bottomNavKeysFor, navItemsFor, type NavItem, type WorkerNavAccess } from "./nav-items";
import { bottomBarKeys, groupNavItems, type NavGroup } from "./nav-prefs";
import { useNavPrefs } from "./use-nav-prefs";

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
  /** Unread messages (Messages only); 0 shows nothing. */
  badge: number;
};

/** What the signed-in account may open; a worker's rights are live, so a change shows at once. */
export function useNavAccess(): WorkerNavAccess {
  const workspace = useWorkspace();
  return useMemo(
    () =>
      workspace.role === "worker"
        ? {
            permissions: workspace.permissions,
            company: canDo(workspace, "company", "view"),
            // Seen also when read-only: their bookings stay readable.
            scheduler: grantAllows(workspace.grants, "scheduler", "own"),
          }
        : null,
    [workspace],
  );
}

/**
 * The sidebar and the phone bar of this account, with lock state merged in
 * and the person's own menu applied (30.9: groups, pins, hidden sections).
 * Only an owner in game mode ever sees a lock; tool mode opens everything and
 * a worker's access is entirely decided by what the owner already granted.
 * `all` is every section the account has, hidden ones included (what
 * Settings → Menu edits); `groups` and `primary` are what the menus draw.
 */
export function useNavItems() {
  const access = useNavAccess();
  const { worker } = useSession();
  const game = useGameState();
  const locale = useLocale();
  const unread = useChatUnread();
  const prefs = useNavPrefs();

  return useMemo(() => {
    const items = navItemsFor(access);
    const bottomKeys = bottomBarKeys(
      bottomNavKeysFor(access),
      prefs,
      items.map((item) => item.key),
    );
    const playing = game.data?.mode === "game";
    const withState: NavItemState[] = items.map((item) => {
      const lockSection = lockSectionOf(item.key);
      const unlockKey =
        !worker && playing && lockSection ? SECTION_UNLOCK_KEYS[lockSection] : null;
      const section = unlockKey
        ? game.data?.sections.find((row) => row.key === unlockKey)
        : undefined;
      // Unknown while loading reads as unlocked, matching the app's rule that
      // page chrome never waits on a network read.
      const badge = item.key === "messages" ? unread : 0;
      if (!section) return { ...item, locked: false, fresh: false, lockHint: null, badge };
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
        badge: section.unlocked ? badge : 0,
      };
    });
    const groups: NavGroup<NavItemState>[] = groupNavItems(withState, prefs);
    const shown = groups.flatMap((group) => group.items);
    // The phone bar keeps the order of the sidebar: pinned first, then the rest.
    const primary = bottomKeys
      .map((key) => shown.find((item) => item.key === key))
      .filter((item): item is NavItemState => item !== undefined);
    return {
      all: withState,
      items: shown,
      groups,
      primary,
      more: shown.filter((item) => !bottomKeys.includes(item.key)),
      moreGroups: groups
        .map((group) => ({ ...group, items: group.items.filter((item) => !bottomKeys.includes(item.key)) }))
        .filter((group) => group.items.length > 0),
    };
  }, [access, worker, game.data, locale, unread, prefs]);
}
