"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { releaseStrayPageLock } from "@/lib/scroll-lock";

/** Long enough for a closing dialog's exit animation and Base UI's deferred unlock. */
const SETTLE_MS = 600;

/**
 * After every page change, once things settle: if no overlay holds the scroll
 * lock and no dialog is open, any lock left on <html> or <body> is cleared,
 * so a page can never arrive frozen until a reload.
 */
export function PageLockGuard() {
  const pathname = usePathname();
  useEffect(() => {
    const timer = window.setTimeout(releaseStrayPageLock, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  return null;
}
