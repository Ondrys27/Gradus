import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { INDUSTRY_KEYS, type IndustryKey } from "../industries";
import { StepShell } from "../step-shell";

export function IndustryStep({
  value,
  onChange,
  onNext,
}: {
  value: IndustryKey | null;
  onChange: (value: IndustryKey) => void;
  onNext: () => void;
}) {
  const t = useTranslations("onboarding.industry");
  const tActions = useTranslations("onboarding.actions");
  return (
    <StepShell
      title={t("title")}
      description={t("description")}
      footer={
        <Button
          type="button"
          size="lg"
          disabled={!value}
          onClick={onNext}
          className="w-full sm:w-auto"
        >
          {tActions("next")}
        </Button>
      }
    >
      <div role="radiogroup" aria-label={t("title")} className="grid gap-2.5 sm:grid-cols-2">
        {INDUSTRY_KEYS.map((key) => {
          const checked = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(key)}
              className={cn(
                "flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 text-left text-[15px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                checked
                  ? "border-violet/60 bg-violet/15 text-ink shadow-glow"
                  : "border-line bg-canvas-deep/60 text-ink-soft hover:border-line-strong",
              )}
            >
              {t(`industries.${key}.label`)}
              {checked && <CheckIcon aria-hidden className="size-4 shrink-0 text-violet" />}
            </button>
          );
        })}
      </div>
    </StepShell>
  );
}
