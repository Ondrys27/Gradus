"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useTranslations } from "next-intl";
import { useCelebration } from "@/components/celebration/celebration-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFinishOnboarding } from "./queries";
import { DEFAULT_INDUSTRY, type IndustryKey } from "./industries";
import { ONBOARDING_STEPS, type OnboardingStep } from "./types";
import { ClosingStep } from "./steps/closing-step";
import { ContactStep } from "./steps/contact-step";
import { IndustryStep } from "./steps/industry-step";
import { MilestoneStep } from "./steps/milestone-step";
import { RegionStep } from "./steps/region-step";
import { WelcomeStep } from "./steps/welcome-step";

/**
 * First-login wizard: welcome, branch, region confirm, first milestone, first
 * contact, then a short Jarvis intro before the completion celebration. Any
 * step can be bypassed at once with "Skip"; the wizard still finishes (and
 * still awards its XP) so it never comes back.
 */
export function OnboardingFlow() {
  const t = useTranslations("onboarding");
  const tCelebration = useTranslations("gamification.celebration.onboardingCompleted");
  const [stepIndex, setStepIndex] = useState(0);
  const [closing, setClosing] = useState(false);
  const [industry, setIndustry] = useState<IndustryKey | null>(null);
  const finish = useFinishOnboarding();
  const { celebrate } = useCelebration();

  const step: OnboardingStep = ONBOARDING_STEPS[stepIndex];

  function finishNow(chosenIndustry: IndustryKey) {
    finish.mutate(chosenIndustry, {
      onSuccess: ({ awarded, xp }) =>
        celebrate({
          title: tCelebration("title"),
          subtitle: tCelebration("subtitle"),
          xp: awarded ? xp : undefined,
        }),
    });
  }

  return (
    <Dialog.Root open disablePointerDismissal>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-60 bg-canvas/90 backdrop-blur-md" />
        <Dialog.Popup
          initialFocus={false}
          className="fixed inset-0 z-60 flex flex-col overflow-y-auto pt-[calc(env(safe-area-inset-top)+16px)] pb-[calc(env(safe-area-inset-bottom)+16px)] outline-none"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 px-4 sm:px-8">
            <ol className="flex items-center gap-1.5" aria-label={t("progress")}>
              {ONBOARDING_STEPS.map((key, index) => (
                <li
                  key={key}
                  className={cn(
                    "h-1.5 w-6 rounded-full transition-colors",
                    !closing && index === stepIndex
                      ? "bg-violet"
                      : closing || index < stepIndex
                        ? "bg-violet/50"
                        : "bg-line",
                  )}
                />
              ))}
            </ol>
            {!closing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => finishNow(industry ?? DEFAULT_INDUSTRY)}
              >
                {t("actions.skip")}
              </Button>
            )}
          </header>

          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 sm:px-8">
            <Dialog.Title className="sr-only">{t("title")}</Dialog.Title>
            {closing ? (
              <ClosingStep industry={industry ?? DEFAULT_INDUSTRY} />
            ) : (
              <>
                {step === "welcome" && <WelcomeStep onNext={() => setStepIndex(1)} />}
                {step === "industry" && (
                  <IndustryStep
                    value={industry}
                    onChange={setIndustry}
                    onNext={() => setStepIndex(2)}
                  />
                )}
                {step === "region" && <RegionStep onNext={() => setStepIndex(3)} />}
                {step === "milestone" && (
                  <MilestoneStep
                    industry={industry ?? DEFAULT_INDUSTRY}
                    onNext={() => setStepIndex(4)}
                  />
                )}
                {step === "contact" && <ContactStep onNext={() => setClosing(true)} />}
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
