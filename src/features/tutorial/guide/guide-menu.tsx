"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { BookOpenIcon, PlayIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useIsPhone } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import type { GuideSection } from "../ui-map/types";
import { AskField } from "./ask-field";
import { guide, useGuide } from "./guide-store";
import { GUIDE_MINUTES, type GuideDepth } from "./section-guide";

/** Where the menu opens on a larger screen: under the "?" that is on screen, else the top right. */
function useAnchor(open: boolean) {
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const buttons = [...document.querySelectorAll<HTMLElement>("[data-guide-button]")];
    const button = buttons.find((element) => element.getBoundingClientRect().width > 0);
    const rect = button?.getBoundingClientRect();
    setAnchor(
      rect
        ? { top: Math.round(rect.bottom + 8), right: Math.max(16, Math.round(window.innerWidth - rect.right)) }
        : { top: 80, right: 16 },
    );
  }, [open]);
  return anchor;
}

/**
 * The menu of the "?" (30.8): the question field first, as the main choice,
 * with three example questions of the section; under it the section's quick
 * look and everything about it. A small panel under the button on a larger
 * screen, a bottom sheet on a phone.
 */
export function GuideMenu({ onStart }: { onStart: (depth: GuideDepth, section: GuideSection) => void }) {
  const t = useTranslations("tutorial");
  const menu = useGuide((state) => state.menu);
  const isPhone = useIsPhone();
  const anchor = useAnchor(menu.open);
  const section = menu.section;
  const onOpenChange = (open: boolean) => {
    if (!open) guide.closeMenu();
  };
  const title = section ? t("guide.menuTitle", { section: t(`guides.${section}.name`) }) : t("guide.button");

  const body = (
    <div className="flex flex-col gap-4" data-testid="guide-menu">
      <AskField section={section} from="menu" autoFocus={!isPhone} />
      {section ? (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <Choice
            icon={<PlayIcon aria-hidden className="size-4" />}
            title={t("guide.quick")}
            minutes={GUIDE_MINUTES.quick}
            testId="guide-quick"
            onClick={() => onStart("quick", section)}
          />
          <Choice
            icon={<BookOpenIcon aria-hidden className="size-4" />}
            title={t("guide.full")}
            minutes={GUIDE_MINUTES.full}
            testId="guide-full"
            onClick={() => onStart("full", section)}
          />
        </div>
      ) : (
        <p className="text-xs text-ink-muted">{t("guide.noSection")}</p>
      )}
    </div>
  );

  if (isPhone) {
    return (
      <BottomSheet open={menu.open} onOpenChange={onOpenChange} title={title} closeLabel={t("guide.close")}>
        {body}
      </BottomSheet>
    );
  }
  return (
    <Dialog.Root open={menu.open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop data-capture-ignore="" className="fixed inset-0 z-overlay bg-canvas/30" />
        <Dialog.Popup
          data-capture-ignore=""
          style={anchor ? { top: anchor.top, right: anchor.right } : undefined}
          className={cn(
            "fixed z-overlay w-[min(100vw-32px,380px)] rounded-2xl border border-line-strong bg-surface p-4 shadow-popover outline-none",
            "transition-[opacity,translate] duration-150 data-ending-style:-translate-y-1 data-ending-style:opacity-0 data-starting-style:-translate-y-1 data-starting-style:opacity-0 motion-reduce:transition-none",
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <Dialog.Title className="micro-label">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={t("guide.close")}
              className="-my-2 -mr-2 grid size-10 place-items-center rounded-full text-ink-soft outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon aria-hidden className="size-4" />
            </Dialog.Close>
          </div>
          {body}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Choice({
  icon,
  title,
  minutes,
  testId,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  minutes: string;
  testId: string;
  onClick: () => void;
}) {
  const t = useTranslations("tutorial");
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex min-h-11 items-center gap-3 rounded-xl px-2 py-2 text-left outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-teal/50"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal/12 text-teal">{icon}</span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{title}</span>
      <span className="shrink-0 text-xs text-ink-muted">{t("guide.minutes", { minutes })}</span>
    </button>
  );
}
