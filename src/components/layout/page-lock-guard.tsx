"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { PAGE_LOCK_SETTLE_MS, releaseStrayPageLock } from "@/lib/scroll-lock";

/**
 * After every page change, once things settle: if no overlay holds the scroll
 * lock and no dialog is open, any lock left on <html> or <body> is cleared,
 * so a page can never arrive frozen until a reload.
 */
export function PageLockGuard() {
  const pathname = usePathname();
  useEffect(() => {
    const timer = window.setTimeout(releaseStrayPageLock, PAGE_LOCK_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  return null;
}
