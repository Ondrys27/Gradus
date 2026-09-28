/**
 * The questions asked after a first meeting. Answers are stored by key, never as
 * translated text, so the same survey reads the same in every language and the
 * AI analysis can group them. Every question is optional.
 */

export const SCALE_MAX = 5;
export const TEXT_MAX = 1000;

export type SurveyQuestion =
  | { key: string; type: "single"; options: readonly string[] }
  | {
      key: string;
      type: "multi";
      options: readonly string[];
      /** An option that excludes all the others, e.g. "no objections". */
      exclusive?: string;
    }
  | { key: string; type: "scale" }
  | { key: string; type: "text" };

export const SURVEY_QUESTIONS: readonly SurveyQuestion[] = [
  {
    key: "duration",
    type: "single",
    options: ["under15", "from15to30", "from30to60", "from60to90", "over90"],
  },
  { key: "format", type: "single", options: ["inPerson", "video", "phone"] },
  {
    key: "attendees",
    type: "multi",
    options: ["decisionMaker", "owner", "teamMember", "finance", "technical", "gatekeeper"],
  },
  { key: "mood", type: "scale" },
  { key: "interest", type: "scale" },
  {
    key: "objections",
    type: "multi",
    options: ["price", "timing", "competitor", "trust", "approval", "noNeed", "none"],
    exclusive: "none",
  },
  {
    key: "whatWorked",
    type: "multi",
    options: ["demo", "references", "story", "listening", "preparation", "offer"],
  },
  { key: "whatDidntWork", type: "text" },
  {
    key: "decisionProcess",
    type: "single",
    options: ["onTheSpot", "needsApproval", "comparing", "later", "unknown"],
  },
  {
    key: "nextStep",
    type: "single",
    options: ["sendOffer", "secondMeeting", "demo", "waitForThem", "followUp", "noNextStep"],
  },
  { key: "confidence", type: "scale" },
  { key: "notes", type: "text" },
];

export type SurveyAnswer = string | string[] | number;
export type SurveyAnswers = Record<string, SurveyAnswer>;

function cleanAnswer(question: SurveyQuestion, value: unknown): SurveyAnswer | null {
  switch (question.type) {
    case "single":
      return typeof value === "string" && question.options.includes(value) ? value : null;
    case "multi": {
      if (!Array.isArray(value)) return null;
      const chosen = question.options.filter((option) => value.includes(option));
      return chosen.length ? chosen : null;
    }
    case "scale":
      return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= SCALE_MAX
        ? (value as number)
        : null;
    case "text": {
      if (typeof value !== "string") return null;
      const text = value.trim().slice(0, TEXT_MAX);
      return text || null;
    }
  }
}

/** Only known questions with a valid, non-empty answer survive; used before saving and when reading. */
export function cleanAnswers(raw: unknown): SurveyAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const clean: SurveyAnswers = {};
  for (const question of SURVEY_QUESTIONS) {
    const answer = cleanAnswer(question, source[question.key]);
    if (answer !== null) clean[question.key] = answer;
  }
  return clean;
}

/** Toggles an option of a multi-choice question, keeping the exclusive one on its own. */
export function toggleOption(
  question: Extract<SurveyQuestion, { type: "multi" }>,
  current: string[],
  option: string,
): string[] {
  if (current.includes(option)) return current.filter((item) => item !== option);
  if (question.exclusive === option) return [option];
  return [...current.filter((item) => item !== question.exclusive), option];
}

export function answeredCount(answers: SurveyAnswers): number {
  return Object.keys(answers).length;
}
