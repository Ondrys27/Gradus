"use client";

import { CompassIcon, GraduationCapIcon, SkipForwardIcon, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Jarvis } from "@/components/jarvis/jarvis";
import { SpeechBubble } from "@/components/jarvis/speech-bubble";
import { FormAlert } from "@/components/ui/form-alert";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { TUTORIAL_MINUTES } from "./steps";
import type { TutorialMode } from "./types";

type Card = { mode: TutorialMode; icon: LucideIcon; minutes: number | null };

const CARDS: readonly Card[] = [
  { mode: "none", icon: SkipForwardIcon, minutes: null },
  { mode: "quick", icon: CompassIcon, minutes: TUTORIAL_MINUTES.quick },
  { mode: "full", icon: GraduationCapIcon, minutes: TUTORIAL_MINUTES.full },
];

/**
 * "How do you want to start?": skip, the quick look (only looking) or the
 * full tutorial on sample data, each with its length and what it gives. At
 * the end of onboarding (after the celebration) and whenever asked for
 * (Settings → Jarvis, Jarvis's panel). The full one only in the user's own
 * space while it can be written to.
 */
export function TutorialChoice({
  open,
  allowFull,
  pending,
  failed,
  onChoose,
  onClose,
}: {
  open: boolean;
  allowFull: boolean;
  /** Which mode is being started (the sample data takes a moment). */
  pending: TutorialMode | null;
  failed: boolean;
  onChoose: (mode: TutorialMode) => void;
  onClose: () => void;
}) {
  const t = useTranslations("tutorial.choice");
  const cards = CARDS.filter((card) => allowFull || card.mode !== "full");
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,820px)]"
    >
      <div data-testid="tutorial-choice" className="flex flex-col gap-4">
        <div className="flex items-end gap-2">
          <div className="shrink-0">
            <Jarvis size={64} state="waving" variant="head" />
          </div>
          <SpeechBubble tail={{ side: "left", align: "end" }} className="flex-1">
            <p className="text-[15px] leading-relaxed text-ink">{t("intro")}</p>
          </SpeechBubble>
        </div>
        <ul className={cn("grid gap-3", cards.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
          {cards.map(({ mode, icon: Icon, minutes }) => (
            <li key={mode} className="flex">
              <button
                type="button"
                data-tutorial-choice={mode}
                disabled={pending !== null}
                onClick={() => onChoose(mode)}
                className={cn(
                  "flex w-full flex-col items-start gap-2 rounded-2xl border p-4 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-teal/50 disabled:opacity-60",
                  mode === "full"
                    ? "border-violet/60 bg-violet/10 hover:bg-violet/15"
                    : "border-line-strong hover:bg-surface-hover",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <Icon aria-hidden className={cn("size-6", mode === "full" ? "text-violet" : "text-teal")} />
                  {minutes !== null && (
                    <span className="text-xs font-semibold text-ink-muted">
                      {t("minutes", { minutes })}
                    </span>
                  )}
                </span>
                <span className="text-base font-semibold text-ink">{t(`${mode}.title`)}</span>
                <span className="text-sm text-ink-soft">{t(`${mode}.text`)}</span>
                <span className="mt-auto pt-1 text-xs text-ink-muted">{t(`${mode}.gain`)}</span>
                {pending === mode && (
                  <span role="status" className="text-xs font-semibold text-teal">
                    {t("preparing")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {failed && <FormAlert>{t("failed")}</FormAlert>}
      </div>
    </ResponsiveDialog>
  );
}
