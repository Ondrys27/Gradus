"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HOME_PATH } from "@/lib/auth/routes";
import { isActivePath, isPathAllowed } from "./nav-items";
import { useNavAccess, useNavItems } from "./use-nav";

/**
 * Keeps an account inside its own sidebar: a worker never sees a section the
 * owner did not open, an owner never lands on the worker pages, and nobody
 * lands on a section they have not unlocked yet by typing its address (the
 * sidebar already hides it; this is the safety net for a direct visit). A
 * section whose lock state has not loaded yet is let through rather than
 * bounced, so page changes never wait on it.
 */
export function SectionGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const access = useNavAccess();
  const { items } = useNavItems();
  const permitted = isPathAllowed(pathname, access);
  const section = items.find((item) => isActivePath(pathname, item.href));
  const allowed = permitted && (!section || !section.locked);

  useEffect(() => {
    if (!allowed) router.replace(HOME_PATH);
  }, [allowed, router]);

  return allowed ? children : null;
}
