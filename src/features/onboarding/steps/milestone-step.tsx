import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TITLE_MAX } from "@/features/milestones/schemas";
import { useSaveFirstMilestone, useWizardMilestone, type FirstMilestone } from "../queries";
import type { IndustryKey } from "../industries";
import { StepShell } from "../step-shell";

/**
 * Tool mode's first milestone with three suggested tasks. Coming back to the
 * step shows the saved milestone and Continue edits it, never adds another.
 */
export function MilestoneStep({
  industry,
  onNext,
  onBack,
}: {
  industry: IndustryKey;
  onNext: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("onboarding.milestone");
  const saved = useWizardMilestone();

  if (saved.isPending) {
    return (
      <StepShell title={t("title")} description={t("description")} onBack={onBack} footer={null}>
        <Skeleton className="h-48 rounded-2xl" />
      </StepShell>
    );
  }
  // A failed lookup must not lead to a second milestone: say so and let Continue retry it.
  return (
    <MilestoneForm
      industry={industry}
      existing={saved.data ?? null}
      lookupFailed={saved.isError}
      retryLookup={() => void saved.refetch()}
      onNext={onNext}
      onBack={onBack}
    />
  );
}

function MilestoneForm({
  industry,
  existing,
  lookupFailed,
  retryLookup,
  onNext,
  onBack,
}: {
  industry: IndustryKey;
  existing: FirstMilestone | null;
  lookupFailed: boolean;
  retryLookup: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("onboarding.milestone");
  const tActions = useTranslations("onboarding.actions");
  const tIndustry = useTranslations("onboarding.industry");
  const save = useSaveFirstMilestone();
  const [failed, setFailed] = useState(false);

  const [title, setTitle] = useState(
    () => existing?.title ?? tIndustry(`industries.${industry}.milestoneTitle`),
  );
  const [tasks, setTasks] = useState<[string, string, string]>(() => {
    if (existing) {
      const at = (position: number) =>
        existing.tasks.find((task) => task.position === position)?.title ?? "";
      return [at(0), at(1), at(2)];
    }
    return [
      tIndustry(`industries.${industry}.task1`),
      tIndustry(`industries.${industry}.task2`),
      tIndustry(`industries.${industry}.task3`),
    ];
  });

  async function next() {
    setFailed(false);
    if (!title.trim()) return;
    if (lookupFailed) {
      setFailed(true);
      retryLookup();
      return;
    }
    try {
      await save.mutateAsync({ existing, title: title.trim(), tasks });
      onNext();
    } catch {
      setFailed(true);
    }
  }

  return (
    <StepShell
      title={t("title")}
      description={t("description")}
      onBack={onBack}
      backDisabled={save.isPending}
      footer={
        <Button
          type="button"
          size="lg"
          disabled={!title.trim() || save.isPending}
          onClick={next}
          className="w-full sm:w-auto"
        >
          {save.isPending ? tActions("saving") : tActions("next")}
        </Button>
      }
    >
      <FormField id="onboarding-milestone-title" label={t("milestoneLabel")}>
        <Input
          id="onboarding-milestone-title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
          {t("tasksLabel")}
        </p>
        {tasks.map((taskTitle, index) => (
          <Input
            key={index}
            aria-label={t("taskLabel", { number: index + 1 })}
            value={taskTitle}
            maxLength={TITLE_MAX}
            onChange={(event) =>
              setTasks((current) => {
                const next = [...current] as typeof current;
                next[index] = event.target.value;
                return next;
              })
            }
          />
        ))}
      </div>
      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}
    </StepShell>
  );
}
