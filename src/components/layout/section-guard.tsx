"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HOME_PATH } from "@/lib/auth/routes";
import { isPathAllowed } from "./nav-items";
import { useNavAccess } from "./use-nav";

/**
 * Keeps an account inside its own sidebar: a worker never sees a section the
 * owner did not open, an owner never lands on the worker pages. Decided from
 * the snapshot loaded at app start, so page changes never wait for it.
 */
export function SectionGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const allowed = isPathAllowed(pathname, useNavAccess());

  useEffect(() => {
    if (!allowed) router.replace(HOME_PATH);
  }, [allowed, router]);

  return allowed ? children : null;
}
