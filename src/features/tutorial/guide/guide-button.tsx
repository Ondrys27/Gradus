"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { CircleHelpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { track } from "@/lib/analytics/client";
import { cn } from "@/lib/utils";
import { guide, useGuide } from "./guide-store";
import { guideSectionOf } from "./sections";

/**
 * The "?" of 30.8, in the same place in every section: the app's top bar and
 * the bar of every page of the administration. Opens the guide's menu (the
 * ? key does the same, guide-host.tsx).
 */
export function GuideButton({ className }: { className?: string }) {
  const t = useTranslations("tutorial");
  const pathname = usePathname();
  const search = useSearchParams();
  const running = useGuide((state) => state.run !== null);
  return (
    <button
      type="button"
      data-guide-button=""
      data-testid="guide-button"
      aria-haspopup="dialog"
      aria-label={t("guide.buttonLabel")}
      title={t("guide.buttonLabel")}
      disabled={running}
      onClick={() => {
        const section = guideSectionOf(pathname, search.toString());
        track("guide_menu_opened", { section: section ?? "none", via: "button" });
        guide.openMenu(section, "button");
      }}
      className={cn(
        "grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40 mouse:size-9",
        className,
      )}
    >
      <CircleHelpIcon aria-hidden className="size-5" />
    </button>
  );
}
