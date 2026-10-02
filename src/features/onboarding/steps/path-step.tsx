import { useMemo } from "react";
import { CheckIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePathList, usePathTemplates } from "@/features/game/overview-queries";
import { pathForIndustry } from "@/features/game/queries";
import { localized } from "@/features/game/types";
import { GameIcon } from "@/features/game/unlock-icon";
import { formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { cn } from "@/lib/utils";
import { industryKeyOf, type IndustryKey } from "../industries";
import { StepShell } from "../step-shell";

/** Milestones of each chapter shown in the preview. */
const PREVIEW_PER_CHAPTER = 2;

/**
 * The path for the game: the one for the chosen branch is preselected, with
 * a preview of its chapters and first milestones.
 */
export function PathStep({
  industry,
  value,
  onChange,
  onNext,
}: {
  industry: IndustryKey;
  value: string | null;
  onChange: (pathKey: string) => void;
  onNext: () => void;
}) {
  const t = useTranslations("onboarding.path");
  const tActions = useTranslations("onboarding.actions");
  const tPath = useTranslations("game.path");
  const locale = useLocale();
  const settings = useFormatSettings();
  const paths = usePathList();
  const templates = usePathTemplates();

  const suggested = paths.data
    ? pathForIndustry(
        paths.data.map((p) => ({ key: p.key, industries: p.industries })),
        industryKeyOf(industry),
      )
    : null;
  const selected = value ?? suggested;

  const chapters = useMemo(() => {
    const steps = (templates.data ?? []).filter((step) => step.pathKey === selected);
    const byChapter = new Map<number, typeof steps>();
    for (const step of steps)
      byChapter.set(step.chapter, [...(byChapter.get(step.chapter) ?? []), step]);
    return [...byChapter.entries()].sort(([a], [b]) => a - b);
  }, [templates.data, selected]);

  return (
    <StepShell
      title={t("title")}
      description={t("description")}
      footer={
        <Button
          type="button"
          size="lg"
          disabled={!selected}
          onClick={() => {
            if (selected && selected !== value) onChange(selected);
            onNext();
          }}
          className="w-full sm:w-auto"
        >
          {tActions("next")}
        </Button>
      }
    >
      {!paths.data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <div role="radiogroup" aria-label={t("title")} className="grid gap-2.5">
          {paths.data.map((path) => {
            const checked = selected === path.key;
            return (
              <button
                key={path.key}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => onChange(path.key)}
                className={cn(
                  "flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  checked
                    ? "border-violet/60 bg-violet/15 shadow-glow"
                    : "border-line bg-canvas-deep/60 hover:border-line-strong",
                )}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet/15 text-violet">
                  <GameIcon name={path.icon} className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                    {localized(path.name, locale)}
                    {path.key === suggested && (
                      <span className="rounded-full bg-teal/15 px-2 py-0.5 text-xs font-medium text-teal">
                        {t("suggested")}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-ink-soft">
                    {localized(path.description, locale)}
                  </span>
                </span>
                {checked && <CheckIcon aria-hidden className="size-4 shrink-0 text-violet" />}
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <section
          aria-label={t("preview")}
          className="rounded-2xl border border-line bg-canvas-deep/40 p-4"
        >
          <h3 className="micro-label mb-3">{t("preview")}</h3>
          {!templates.data ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : (
            <ol className="flex flex-col gap-3">
              {chapters.map(([chapter, steps]) => (
                <li key={chapter} className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-ink">
                    {tPath("chapter", { number: formatNumber(chapter, {}, settings) })} ·{" "}
                    {tPath(`chapters.${chapter}`)}
                  </span>
                  <ul className="flex flex-col gap-0.5 pl-5 text-sm text-ink-soft">
                    {steps.slice(0, PREVIEW_PER_CHAPTER).map((step) => (
                      <li key={step.id} className="list-disc">
                        {localized(step.title, locale)}
                      </li>
                    ))}
                    {steps.length > PREVIEW_PER_CHAPTER && (
                      <li className="text-xs text-ink-muted">
                        {t("more", {
                          count: steps.length - PREVIEW_PER_CHAPTER,
                          countFormatted: formatNumber(
                            steps.length - PREVIEW_PER_CHAPTER,
                            {},
                            settings,
                          ),
                        })}
                      </li>
                    )}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </StepShell>
  );
}
