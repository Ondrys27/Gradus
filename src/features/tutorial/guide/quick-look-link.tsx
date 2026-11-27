"use client";

import { PlayCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { track } from "@/lib/analytics/client";
import { cn } from "@/lib/utils";
import type { GuideSection } from "../ui-map/types";
import { guide } from "./guide-store";
import { GUIDE_MINUTES } from "./section-guide";

/**
 * "Quick look · 1–2 min" (30.9): a quiet link under an empty state that plays
 * the section's quick guide of 30.8, so a first visit has somewhere to go
 * besides the one action. Nothing is loaded for it; the guide host plays it.
 */
export function QuickLookLink({ section, className }: { section: GuideSection; className?: string }) {
  const t = useTranslations("emptyState");
  return (
    <button
      type="button"
      data-testid="empty-quick-look"
      aria-label={t("quickLookLabel")}
      onClick={() => {
        track("guide_menu_opened", { section, via: "button" });
        guide.requestRun("quick", section);
      }}
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 mouse:min-h-8",
        className,
      )}
    >
      <PlayCircleIcon aria-hidden className="size-4" />
      {t("quickLook", { minutes: GUIDE_MINUTES.quick })}
    </button>
  );
}
