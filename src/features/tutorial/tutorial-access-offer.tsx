"use client";

import { useTranslations } from "next-intl";
import { Grady } from "@/components/grady/grady";
import { Button } from "@/components/ui/button";

/**
 * Grady's short offer once a worker's rights grew (30.2): "You now have
 * access to Finance — shall I show you?" Show runs a look at just those
 * sections, Not now leaves it; either way it is offered once. Bottom left of
 * the content like his other callouts, never over a dialog.
 */
export function TutorialAccessOffer({
  sections,
  onShow,
  onDismiss,
}: {
  /** The sections' names in the interface's language. */
  sections: string[];
  onShow: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("tutorial.accessOffer");
  return (
    <section
      aria-labelledby="tutorial-access-offer-title"
      data-tutorial-overlay="access-offer"
      data-testid="tutorial-access-offer"
      data-capture-ignore=""
      className="fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-nav flex items-end gap-2 md:inset-x-auto md:bottom-6 md:left-[calc(var(--app-sidebar-width)+24px)] md:w-[380px]"
    >
      <div className="shrink-0">
        <Grady size={56} state="waving" variant="head" />
      </div>
      <div className="min-w-0 flex-1 rounded-2xl border border-line-strong bg-surface/95 p-3 shadow-popover md:backdrop-blur-md">
        <h2 id="tutorial-access-offer-title" className="text-sm font-semibold text-teal">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-ink">{t("text", { sections: sections.join(", ") })}</p>
        <div className="mt-3 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={onDismiss} data-testid="tutorial-access-dismiss">
            {t("dismiss")}
          </Button>
          <Button size="sm" onClick={onShow} data-testid="tutorial-access-show">
            {t("show")}
          </Button>
        </div>
      </div>
    </section>
  );
}
