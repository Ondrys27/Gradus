"use client";

import { SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useIsMac } from "@/lib/use-is-mac";
import { cn } from "@/lib/utils";
import { useSearchPalette } from "./search-provider";

/** The field in the top bar: looks like an input, opens the search window. */
export function SearchTrigger({ className }: { className?: string }) {
  const t = useTranslations("search.trigger");
  const { setOpen } = useSearchPalette();
  const isMac = useIsMac();
  const shortcut = isMac ? t("shortcutMac") : t("shortcutOther");

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={t("label")}
      aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
      aria-haspopup="dialog"
      data-tour="search"
      className={cn(
        "group flex h-11 w-full cursor-pointer items-center gap-3 rounded-full border border-line bg-surface/60 pr-2 pl-4 text-left text-sm text-ink-muted outline-none transition-colors hover:border-line-strong hover:text-ink-soft focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <SearchIcon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{t("placeholder")}</span>
      <kbd className="inline-flex h-7 shrink-0 items-center rounded-full border border-line bg-canvas/60 px-2.5 font-sans text-xs text-ink-soft">
        {shortcut}
      </kbd>
    </button>
  );
}

/** The magnifier on a phone. */
export function SearchIconButton({ className }: { className?: string }) {
  const t = useTranslations("search.trigger");
  const { setOpen } = useSearchPalette();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={t("open")}
      aria-haspopup="dialog"
      data-tour="search"
      className={cn(
        "grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <SearchIcon aria-hidden className="size-5" />
    </button>
  );
}
