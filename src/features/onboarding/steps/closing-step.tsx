import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { GameMode } from "@/features/game/types";
import { StepShell } from "../step-shell";

export function ClosingStep({
  mode,
  pending,
  onFinish,
  onBack,
}: {
  mode: GameMode;
  pending: boolean;
  onFinish: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("onboarding.closing");
  const tActions = useTranslations("onboarding.actions");
  return (
    <StepShell
      jarvisState="happy"
      title={t("title")}
      description={mode === "game" ? t("descriptionGame") : t("description")}
      onBack={onBack}
      backDisabled={pending}
      footer={
        <Button
          type="button"
          size="lg"
          autoFocus
          disabled={pending}
          onClick={onFinish}
          className="w-full sm:w-auto"
        >
          {pending ? tActions("saving") : tActions("finish")}
        </Button>
      }
    />
  );
}
