"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** How often the open Feedback page asks whether new reports came in. */
export const NEW_REPORTS_POLL_MS = 30_000;

/**
 * New bug reports without a reload (27.1): while the tab is visible the page
 * asks every 30 s how many came in since it was rendered and shows "Refresh ·
 * 2 new"; the click renders the list again (and with it a new `since`).
 */
export function NewReportsNotice({ since }: { since: string }) {
  const t = useTranslations("admin.feedback");
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [refreshing, startTransition] = useTransition();

  useEffect(() => {
    setCount(0);
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`/api/admin-reports/new?since=${encodeURIComponent(since)}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { count?: number };
        if (!cancelled && typeof body.count === "number") setCount(body.count);
      } catch {
        // Offline for a moment: the next round asks again.
      }
    };
    const timer = window.setInterval(check, NEW_REPORTS_POLL_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [since]);

  if (count === 0) return null;
  return (
    <div className="mb-3 flex" aria-live="polite">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => startTransition(() => router.refresh())}
        disabled={refreshing}
        data-testid="new-reports"
      >
        <RefreshCwIcon
          aria-hidden
          className={cn(refreshing && "animate-spin motion-reduce:animate-none")}
        />
        {t("newReports", { count })}
      </Button>
    </div>
  );
}
