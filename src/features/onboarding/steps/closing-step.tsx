import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useCelebration } from "@/components/celebration/celebration-provider";
import { useFinishOnboarding } from "../queries";
import type { IndustryKey } from "../industries";
import { StepShell } from "../step-shell";

export function ClosingStep({ industry }: { industry: IndustryKey }) {
  const t = useTranslations("onboarding.closing");
  const tActions = useTranslations("onboarding.actions");
  const tCelebration = useTranslations("gamification.celebration.onboardingCompleted");
  const finish = useFinishOnboarding();
  const { celebrate } = useCelebration();

  function done() {
    finish.mutate(industry, {
      onSuccess: ({ awarded, xp }) =>
        celebrate({
          title: tCelebration("title"),
          subtitle: tCelebration("subtitle"),
          xp: awarded ? xp : undefined,
        }),
    });
  }

  return (
    <StepShell
      jarvisState="happy"
      title={t("title")}
      description={t("description")}
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
