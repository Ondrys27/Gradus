"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Jarvis } from "@/components/jarvis/jarvis";
import { Button } from "@/components/ui/button";

const SHOW_AFTER_MS = 1500;

/**
 * Jarvis's offer to go on with a tutorial left half way (the next day, or a
 * while after a reload): where it stopped, Go on or End. Bottom left of the
 * content, never over a dialog.
 */
export function TutorialResume({
  stepTitle,
  pending,
  onResume,
  onEnd,
}: {
  stepTitle: string | null;
  pending: boolean;
  onResume: () => void;
  onEnd: () => void;
}) {
  const t = useTranslations("tutorial.resume");
  // Comes in once the page has settled, not over it while it loads.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return (
    <section
      aria-labelledby="tutorial-resume-title"
      data-tutorial-overlay="resume"
      data-capture-ignore=""
      className="fixed inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-nav flex items-end gap-2 md:inset-x-auto md:bottom-6 md:left-[calc(var(--app-sidebar-width)+24px)] md:w-[380px]"
    >
      <div className="shrink-0">
        <Jarvis size={56} state="waving" variant="head" />
      </div>
      <div className="min-w-0 flex-1 rounded-2xl border border-line-strong bg-surface/95 p-3 shadow-popover backdrop-blur-md">
        <h2 id="tutorial-resume-title" className="text-sm font-semibold text-teal">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-ink">
          {stepTitle ? t("text", { step: stepTitle }) : t("textNoStep")}
        </p>
        <div className="mt-3 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" disabled={pending} onClick={onEnd}>
            {t("end")}
          </Button>
          <Button size="sm" disabled={pending} onClick={onResume}>
            {t("resume")}
          </Button>
        </div>
      </div>
    </section>
  );
}
