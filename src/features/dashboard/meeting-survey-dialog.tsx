"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Textarea } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useFreshOnOpen } from "@/features/milestones/use-fresh-on-open";
import { cn } from "@/lib/utils";
import { useSaveMeetingSurvey } from "./queries";
import {
  answeredCount,
  cleanAnswers,
  SCALE_MAX,
  SURVEY_QUESTIONS,
  TEXT_MAX,
  toggleOption,
  type SurveyAnswer,
  type SurveyQuestion,
} from "./survey-questions";

export type SurveyTarget = { dealId: string; dealTitle: string; stageId: string | null };

type Props = {
  /** The deal whose meeting is asked about; the dialog is open while there is one. */
  target: SurveyTarget | null;
  onClose: () => void;
};

/** A short questionnaire about the meeting a deal has just moved on from. Every question is optional. */
export function MeetingSurveyDialog({ target, onClose }: Props) {
  const t = useTranslations("dashboard.survey");
  const generation = useFreshOnOpen(target !== null);
  // Keep the last deal on screen while the dialog closes.
  const [shown, setShown] = useState<SurveyTarget | null>(target);
  if (target && target !== shown) setShown(target);
  const current = target ?? shown;

  return (
    <ResponsiveDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("title")}
      closeLabel={t("close")}
      className="w-[min(100vw-32px,560px)]"
    >
      {current && <SurveyForm key={generation} target={current} onClose={onClose} />}
    </ResponsiveDialog>
  );
}

const chip =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border px-3.5 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-violet/40 mouse:min-h-9";
const chipOn = "border-violet bg-violet/20 text-ink";
const chipOff = "border-line text-ink-soft hover:border-line-strong hover:text-ink";

function SurveyForm({ target, onClose }: { target: SurveyTarget; onClose: () => void }) {
  const t = useTranslations("dashboard.survey");
  const save = useSaveMeetingSurvey();
  const [answers, setAnswers] = useState<Record<string, SurveyAnswer>>({});
  const [failed, setFailed] = useState(false);
  const cleaned = cleanAnswers(answers);

  function setAnswer(key: string, value: SurveyAnswer | undefined) {
    setAnswers((current) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (answeredCount(cleaned) === 0) return;
    setFailed(false);
    save.mutate(
      { dealId: target.dealId, stageId: target.stageId, answers: cleaned },
      { onSuccess: onClose, onError: () => setFailed(true) },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <p className="text-sm text-ink-soft">{t("description", { deal: target.dealTitle })}</p>

      {SURVEY_QUESTIONS.map((question) => (
        <Question
          key={question.key}
          question={question}
          value={answers[question.key]}
          onChange={(value) => setAnswer(question.key, value)}
        />
      ))}

      {failed && <FormAlert>{t("saveFailed")}</FormAlert>}

      <div className="sticky bottom-0 -mx-1 flex flex-col-reverse gap-2 bg-surface px-1 pt-2 pb-1 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("skip")}
        </Button>
        <Button type="submit" disabled={answeredCount(cleaned) === 0 || save.isPending}>
          {save.isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}

function Question({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestion;
  value: SurveyAnswer | undefined;
  onChange: (value: SurveyAnswer | undefined) => void;
}) {
  const t = useTranslations("dashboard.survey.questions");
  const id = `survey-${question.key}`;

  if (question.type === "text") {
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {t(`${question.key}.label`)}
        </label>
        <Textarea
          id={id}
          value={typeof value === "string" ? value : ""}
          maxLength={TEXT_MAX}
          placeholder={t(`${question.key}.placeholder`)}
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      </div>
    );
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-ink">{t(`${question.key}.label`)}</legend>
      {question.type === "scale" ? (
        <>
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: SCALE_MAX }, (_, index) => index + 1).map((step) => (
              <button
                key={step}
                type="button"
                aria-pressed={value === step}
                onClick={() => onChange(value === step ? undefined : step)}
                className={cn(chip, "tabular-nums", value === step ? chipOn : chipOff)}
              >
                {step}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-xs text-ink-muted">
            <span>{t(`${question.key}.low`)}</span>
            <span>{t(`${question.key}.high`)}</span>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {question.options.map((option) => {
            const selected =
              question.type === "multi"
                ? Array.isArray(value) && value.includes(option)
                : value === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  if (question.type === "multi") {
                    const next = toggleOption(question, Array.isArray(value) ? value : [], option);
                    onChange(next.length ? next : undefined);
                  } else {
                    onChange(selected ? undefined : option);
                  }
                }}
                className={cn(chip, selected ? chipOn : chipOff)}
              >
                {t(`${question.key}.options.${option}`)}
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
