import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { TITLE_MAX } from "@/features/milestones/schemas";
import { useCreateFirstMilestone } from "../queries";
import type { IndustryKey } from "../industries";
import { StepShell } from "../step-shell";

export function MilestoneStep({ industry, onNext }: { industry: IndustryKey; onNext: () => void }) {
  const t = useTranslations("onboarding.milestone");
  const tActions = useTranslations("onboarding.actions");
  const tIndustry = useTranslations("onboarding.industry");
  const create = useCreateFirstMilestone();
  const [failed, setFailed] = useState(false);

  const [title, setTitle] = useState(() => tIndustry(`industries.${industry}.milestoneTitle`));
  const [tasks, setTasks] = useState<[string, string, string]>(() => [
    tIndustry(`industries.${industry}.task1`),
    tIndustry(`industries.${industry}.task2`),
    tIndustry(`industries.${industry}.task3`),
  ]);

  async function next() {
    setFailed(false);
    if (!title.trim()) return;
    try {
      await create.mutateAsync({ title: title.trim(), tasks });
      onNext();
    } catch {
      setFailed(true);
    }
  }

  return (
    <StepShell
      title={t("title")}
      description={t("description")}
      footer={
        <Button
          type="button"
          size="lg"
          disabled={!title.trim() || create.isPending}
          onClick={next}
          className="w-full sm:w-auto"
        >
          {create.isPending ? tActions("saving") : tActions("next")}
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
