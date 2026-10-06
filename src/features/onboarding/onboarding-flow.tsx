"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useTranslations } from "next-intl";
import { useCelebration } from "@/components/celebration/celebration-provider";
import { Button } from "@/components/ui/button";
import type { GameMode } from "@/features/game/types";
import { cn } from "@/lib/utils";
import { useFinishOnboarding, type FinishOnboardingInput } from "./queries";
import { DEFAULT_INDUSTRY, type IndustryKey } from "./industries";
import { onboardingSteps } from "./types";
import { ClosingStep } from "./steps/closing-step";
import { ContactStep } from "./steps/contact-step";
import { IndustryStep } from "./steps/industry-step";
import { MilestoneStep } from "./steps/milestone-step";
import { ModeStep } from "./steps/mode-step";
import { PathStep } from "./steps/path-step";
import { RegionStep } from "./steps/region-step";
import { WelcomeStep } from "./steps/welcome-step";

/**
 * First-login wizard: welcome, how to use the app (game or tool), branch,
 * then the path (game) or a first milestone (tool), region, first contact and
 * a short Jarvis intro before the completion celebration. Any step can be
 * bypassed at once with "Skip"; the wizard still finishes (in game mode with
 * the path for the branch, unless tool mode was picked) so it never comes back.
 */
export function OnboardingFlow() {
  const t = useTranslations("onboarding");
  const tCelebration = useTranslations("game.celebration.onboardingCompleted");
  const [stepIndex, setStepIndex] = useState(0);
  const [closing, setClosing] = useState(false);
  const [mode, setMode] = useState<GameMode | null>(null);
  const [industry, setIndustry] = useState<IndustryKey | null>(null);
  const [pathKey, setPathKey] = useState<string | null>(null);
  const finish = useFinishOnboarding();
  const { celebrate } = useCelebration();

  const steps = onboardingSteps(mode);
  const step = steps[stepIndex] ?? "welcome";
  const next = () => setStepIndex((index) => index + 1);
  const input: FinishOnboardingInput = {
    industry: industry ?? DEFAULT_INDUSTRY,
    mode: mode ?? "game",
    pathKey,
  };

  function finishNow() {
    finish.mutate(input, {
      onSuccess: () => {
        if (input.mode === "game") {
          celebrate({ title: tCelebration("title"), subtitle: tCelebration("subtitle") });
        }
      },
    });
  }

  return (
    <Dialog.Root open disablePointerDismissal>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-takeover bg-canvas/90 backdrop-blur-md" />
        <Dialog.Popup
          initialFocus={false}
          className="fixed inset-0 z-takeover flex h-dvh flex-col overflow-hidden pt-[calc(env(safe-area-inset-top)+16px)] pb-[calc(env(safe-area-inset-bottom)+16px)] outline-none"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 px-4 sm:px-8">
            <ol className="flex items-center gap-1.5" aria-label={t("progress")}>
              {steps.map((key, index) => (
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
              <Button variant="ghost" size="sm" disabled={finish.isPending} onClick={finishNow}>
                {t("actions.skip")}
              </Button>
            )}
          </header>

          <div className="mx-auto flex w-full max-w-md min-h-0 flex-1 flex-col px-4 py-6 sm:px-8">
            <Dialog.Title className="sr-only">{t("title")}</Dialog.Title>
            {closing ? (
              <ClosingStep input={input} />
            ) : (
              <>
                {step === "welcome" && <WelcomeStep onNext={next} />}
                {step === "mode" && (
                  <ModeStep
                    value={mode}
                    onChoose={(value) => {
                      setMode(value);
                      next();
                    }}
                  />
                )}
                {step === "industry" && (
                  <IndustryStep
                    value={industry}
                    onChange={(value) => {
                      setIndustry(value);
                      // A new branch suggests its own path again.
                      setPathKey(null);
                    }}
                    onNext={next}
                  />
                )}
                {step === "path" && (
                  <PathStep
                    industry={industry ?? DEFAULT_INDUSTRY}
                    value={pathKey}
                    onChange={setPathKey}
                    onNext={next}
                  />
                )}
                {step === "region" && <RegionStep onNext={next} />}
                {step === "milestone" && (
                  <MilestoneStep industry={industry ?? DEFAULT_INDUSTRY} onNext={next} />
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
