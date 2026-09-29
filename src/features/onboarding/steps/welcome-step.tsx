import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/constants";
import { StepShell } from "../step-shell";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const t = useTranslations("onboarding.welcome");
  const tActions = useTranslations("onboarding.actions");
  return (
    <StepShell
      jarvisState="happy"
      title={t("title", { appName: APP_NAME })}
      description={t("description", { appName: APP_NAME })}
      footer={
        <Button type="button" size="lg" autoFocus onClick={onNext} className="w-full sm:w-auto">
          {tActions("start")}
        </Button>
      }
    />
  );
}
