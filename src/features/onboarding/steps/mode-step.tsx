import { CheckIcon, Gamepad2Icon, WrenchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { GameMode } from "@/features/game/types";
import { StepShell } from "../step-shell";

const OPTIONS: { mode: GameMode; icon: typeof Gamepad2Icon }[] = [
  { mode: "game", icon: Gamepad2Icon },
  { mode: "tool", icon: WrenchIcon },
];

/** "How do you want to use Gradus?": play the game, or just use the app. A tap moves on. */
export function ModeStep({
  value,
  onChoose,
}: {
  value: GameMode | null;
  onChoose: (mode: GameMode) => void;
}) {
  const t = useTranslations("onboarding.mode");
  return (
    <StepShell
      title={t("title", { appName: APP_NAME })}
      description={t("description")}
      footer={<p className="text-center text-xs text-ink-muted">{t("changeLater")}</p>}
    >
      <div role="radiogroup" aria-label={t("title", { appName: APP_NAME })} className="grid gap-3">
        {OPTIONS.map(({ mode, icon: Icon }) => {
          const checked = value === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChoose(mode)}
              className={cn(
                "flex min-h-28 cursor-pointer items-start gap-4 rounded-2xl border p-5 text-left outline-none transition-[border-color,box-shadow,background-color] focus-visible:ring-3 focus-visible:ring-ring/50",
                checked
                  ? "border-violet/60 bg-violet/15 shadow-glow-strong"
                  : "border-line bg-canvas-deep/60 hover:border-line-strong",
              )}
            >
              <span
                className={cn(
                  "grid size-12 shrink-0 place-items-center rounded-xl",
                  mode === "game" ? "bg-violet/20 text-violet" : "bg-teal/15 text-teal",
                )}
              >
                <Icon aria-hidden className="size-6" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-lg font-semibold text-ink">{t(`${mode}.title`)}</span>
                <span className="text-sm text-ink-soft">{t(`${mode}.description`)}</span>
              </span>
              {checked && <CheckIcon aria-hidden className="mt-1 size-5 shrink-0 text-violet" />}
            </button>
          );
        })}
      </div>
    </StepShell>
  );
}
