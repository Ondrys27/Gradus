"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useTranslations } from "next-intl";
import { useCelebration } from "@/components/celebration/celebration-provider";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/account/queries";
import { cn } from "@/lib/utils";
import {
  useFinishOnboarding,
  useWizardContact,
  useWizardMilestone,
  type FinishOnboardingInput,
} from "./queries";
import { DEFAULT_INDUSTRY } from "./industries";
import { onboardingSteps } from "./types";
import { useWizard } from "./use-wizard";
import { withIndustry, withMode, withPath } from "./wizard-state";
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
 *
 * The step is in the address and every step but the welcome has Back (see
 * `useWizard`). Going back keeps the answers; what a step already saved (the
 * region, the first milestone, the first contact) is edited when it is
 * confirmed again, never added twice, and the path is only applied at the end.
 */
export function OnboardingFlow() {
  const t = useTranslations("onboarding");
  const tCelebration = useTranslations("game.celebration.onboardingCompleted");
  const { user } = useSession();
  const { step, draft, advance, back, update, clear } = useWizard(user.id);
  const finish = useFinishOnboarding();
  const { celebrate } = useCelebration();
  // Looked up right away, so the steps that edit them do not wait.
  useWizardMilestone();
  useWizardContact();

  const steps = onboardingSteps(draft.mode);
  const closing = step === "closing";
  const current = closing ? steps.length : steps.indexOf(step);
  const input: FinishOnboardingInput = {
    industry: draft.industry ?? DEFAULT_INDUSTRY,
    mode: draft.mode ?? "game",
    pathKey: draft.pathKey,
  };

  function finishWizard(skippedAt?: FinishOnboardingInput["skippedAt"]) {
    finish.mutate(
      { ...input, ...(skippedAt ? { skippedAt } : {}) },
      {
        onSuccess: () => {
          clear();
          // Tool mode celebrates only a milestone and a win, not the setup.
          if (input.mode === "game") {
            celebrate({ title: tCelebration("title"), subtitle: tCelebration("subtitle") });
          }
        },
      },
    );
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
                    index === current ? "bg-violet" : index < current ? "bg-violet/50" : "bg-line",
                  )}
                />
              ))}
            </ol>
            {!closing && (
              <Button
                variant="ghost"
                size="sm"
                disabled={finish.isPending}
                onClick={() => finishWizard(step)}
              >
                {t("actions.skip")}
              </Button>
            )}
          </header>

          <div className="mx-auto flex w-full max-w-md min-h-0 flex-1 flex-col px-4 py-6 sm:px-8">
            <Dialog.Title className="sr-only">{t("title")}</Dialog.Title>
            {step === "welcome" && <WelcomeStep onNext={() => advance()} />}
            {step === "mode" && (
              <ModeStep
                value={draft.mode}
                onChoose={(value) => advance((d) => withMode(d, value))}
                onBack={back}
              />
            )}
            {step === "industry" && (
              <IndustryStep
                value={draft.industry}
                onChange={(value) => update((d) => withIndustry(d, value))}
                onNext={() => advance()}
                onBack={back}
              />
            )}
            {step === "path" && (
              <PathStep
                industry={draft.industry ?? DEFAULT_INDUSTRY}
                value={draft.pathKey}
                onChange={(value) => update((d) => withPath(d, value))}
                onNext={(value) => advance((d) => withPath(d, value))}
                onBack={back}
              />
            )}
            {step === "region" && (
              <RegionStep
                detect={!draft.done.includes("region")}
                onNext={() => advance()}
                onBack={back}
              />
            )}
            {step === "milestone" && (
              <MilestoneStep
                industry={draft.industry ?? DEFAULT_INDUSTRY}
                onNext={() => advance()}
                onBack={back}
              />
            )}
            {step === "contact" && <ContactStep onNext={() => advance()} onBack={back} />}
            {closing && (
              <ClosingStep
                mode={input.mode}
                pending={finish.isPending}
                onFinish={() => finishWizard()}
                onBack={back}
              />
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
