import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useCelebration } from "@/components/celebration/celebration-provider";
import { useFinishOnboarding, type FinishOnboardingInput } from "../queries";
import { StepShell } from "../step-shell";

export function ClosingStep({ input }: { input: FinishOnboardingInput }) {
  const t = useTranslations("onboarding.closing");
  const tActions = useTranslations("onboarding.actions");
  const tCelebration = useTranslations("game.celebration.onboardingCompleted");
  const finish = useFinishOnboarding();
  const { celebrate } = useCelebration();

  function done() {
    finish.mutate(input, {
      // Tool mode celebrates only a milestone and a win, not the setup.
      onSuccess: () => {
        if (input.mode === "game") {
          celebrate({ title: tCelebration("title"), subtitle: tCelebration("subtitle") });
        }
      },
    });
  }

  return (
    <StepShell
      jarvisState="happy"
      title={t("title")}
      description={input.mode === "game" ? t("descriptionGame") : t("description")}
      footer={
        <Button
          type="button"
          size="lg"
          autoFocus
          disabled={finish.isPending}
          onClick={done}
          className="w-full sm:w-auto"
        >
          {finish.isPending ? tActions("saving") : tActions("finish")}
        </Button>
      }
    />
  );
}
