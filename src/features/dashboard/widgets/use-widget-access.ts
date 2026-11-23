"use client";

import { useMemo } from "react";
import { useNavItems } from "@/components/layout/use-nav";
import { can } from "@/features/account/workspace";
import { useWorkspace } from "@/features/account/workspace-queries";
import { useIsPlaying } from "@/features/game/queries";
import type { GrantAction, GrantSection } from "@/features/workers/permissions-catalog";
import type { WidgetAccess } from "./access";

/**
 * The widget rules of access.ts fed with the live state of the account: the
 * rights in the active space (a worker's change at once, like useCan), the
 * sections open in the menu and the owner's list of widgets for a worker.
 */
export function useWidgetAccess(allowList: readonly string[] | null): WidgetAccess {
  const workspace = useWorkspace();
  const { items } = useNavItems();
  const playing = useIsPlaying();
  return useMemo(
    () => ({
      role: workspace.role,
      can: (section: string, action: string) =>
        can(workspace, section as GrantSection, action as GrantAction),
      navOpen: new Set(items.filter((item) => !item.locked).map((item) => item.key as string)),
      playing,
      allowList,
    }),
    [workspace, items, playing, allowList],
  );
}
