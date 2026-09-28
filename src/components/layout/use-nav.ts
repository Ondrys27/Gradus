"use client";

import { useMemo } from "react";
import { useSession } from "@/features/account/queries";
import { bottomNavKeysFor, navItemsFor, type WorkerNavAccess } from "./nav-items";

/** What the signed-in account may open, from the snapshot loaded when the app started. */
export function useNavAccess(): WorkerNavAccess {
  const { worker } = useSession();
  return useMemo(() => (worker ? { permissions: worker.permissions } : null), [worker]);
}

/** The sidebar and the phone bar of this account. */
export function useNavItems() {
  const access = useNavAccess();
  return useMemo(() => {
    const items = navItemsFor(access);
    const bottomKeys = bottomNavKeysFor(access);
    return {
      items,
      primary: items.filter((item) => bottomKeys.includes(item.key)),
      more: items.filter((item) => !bottomKeys.includes(item.key)),
    };
  }, [access]);
}
