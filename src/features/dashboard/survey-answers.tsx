"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatList, formatNumber } from "@/lib/format";
import { useFormatSettings } from "@/lib/use-format-settings";
import { SCALE_MAX, SURVEY_QUESTIONS, type SurveyAnswers } from "./survey-questions";

/** The answered questions of one survey as a label and value list. */
export function SurveyAnswerList({ answers }: { answers: SurveyAnswers }) {
  const t = useTranslations("dashboard.survey.questions");
  const locale = useLocale();
  const settings = useFormatSettings();

  const rows = SURVEY_QUESTIONS.flatMap((question) => {
    const answer = answers[question.key];
    if (answer === undefined) return [];
    let value: string;
    if (Array.isArray(answer)) {
      value = formatList(
        answer.map((option) => t(`${question.key}.options.${option}`)),
        locale,
      );
    } else if (typeof answer === "number") {
      value = `${formatNumber(answer, {}, settings)} / ${formatNumber(SCALE_MAX, {}, settings)}`;
    } else if (question.type === "text") {
      value = answer;
    } else {
      value = t(`${question.key}.options.${answer}`);
    }
    return [{ key: question.key, label: t(`${question.key}.label`), value }];
  });

  return (
    <dl className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <div key={row.key} className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-muted">{row.label}</dt>
          <dd className="text-sm break-words whitespace-pre-line text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
