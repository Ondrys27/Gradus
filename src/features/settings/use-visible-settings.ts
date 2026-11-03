"use client";

import { useMemo } from "react";
import { useSession } from "@/features/account/queries";
import { useCan, useWorkspace } from "@/features/account/workspace-queries";
import {
  visibleSettingsGroups,
  visibleSettingsItems,
  type SettingsGroupDef,
  type SettingsItemDef,
  type SettingsViewer,
} from "./groups";

/** Who is looking at the settings: decides which groups and items exist for them. */
export function useSettingsViewer(): SettingsViewer {
  const owner = useWorkspace().role === "owner";
  const { worker } = useSession();
  const canMakeDeals = useCan("pipeline", "create");
  const canCall = useCan("cold_calling", "view");
  return useMemo(
    () => ({ owner, worker: Boolean(worker), caller: canMakeDeals && canCall }),
    [owner, worker, canMakeDeals, canCall],
  );
}

export function useVisibleSettings(): { groups: SettingsGroupDef[]; items: SettingsItemDef[] } {
  const viewer = useSettingsViewer();
  return useMemo(
    () => ({ groups: visibleSettingsGroups(viewer), items: visibleSettingsItems(viewer) }),
    [viewer],
  );
}
