/**
 * What Jarvis may ask now and then so he can advise better. The visible
 * wording lives in `jarvis.proactive.questions.<key>`; `about` and the option
 * labels here are what the model reads next to the answer. Shared by the
 * server and the browser, so no zod.
 */

export type JarvisQuestion = {
  key: string;
  /** "month": asked again every calendar month; "once": asked one time. */
  period: "month" | "once";
  /** Option keys with their meaning for the model, in the order shown. */
  options: Record<string, string>;
  /** Whether a free answer is accepted besides the options. */
  freeText: boolean;
  /** What the answer tells Jarvis, for his context. */
  about: string;
};

export const JARVIS_QUESTIONS: readonly JarvisQuestion[] = [
  {
    key: "monthlyGoal",
    period: "month",
    options: {
      firstClient: "Land the first client",
      moreClients: "Win more clients",
      revenue: "Grow revenue",
      launch: "Launch the business",
    },
    freeText: true,
    about: "Main goal for this month",
  },
  {
    key: "callingHours",
    period: "once",
    options: {
      h2: "About 2 hours a week",
      h5: "About 5 hours a week",
      h10: "About 10 hours a week",
      h20: "20 hours a week or more",
    },
    freeText: false,
    about: "Time per week the user wants to spend on calling",
  },
  {
    key: "obstacle",
    period: "once",
    options: {
      time: "Not enough time",
      leads: "Not enough people to offer it to",
      confidence: "Selling and calling feel uncomfortable",
      money: "Money is tight",
    },
    freeText: true,
    about: "The biggest obstacle right now",
  },
  {
    key: "idealCustomer",
    period: "once",
    options: {},
    freeText: true,
    about: "Who the ideal customer is",
  },
];

/** Longest free answer kept. */
export const ANSWER_MAX = 300;

export function questionByKey(key: string): JarvisQuestion | undefined {
  return JARVIS_QUESTIONS.find((question) => question.key === key);
}

/** One row per question and period: a monthly question gets a new key each month. */
export function questionDedupeKey(question: JarvisQuestion, today: string): string {
  return question.period === "month"
    ? `question:${question.key}:${today.slice(0, 7)}`
    : `question:${question.key}`;
}

/** The first question not asked yet for its period, or null when all have been. */
export function nextQuestion(asked: ReadonlySet<string>, today: string): JarvisQuestion | null {
  return JARVIS_QUESTIONS.find((q) => !asked.has(questionDedupeKey(q, today))) ?? null;
}

/** An option key, or a trimmed free answer when the question takes one; null otherwise. */
export function normalizeAnswer(question: JarvisQuestion, answer: string): string | null {
  const value = answer.trim().replace(/\s+/g, " ");
  if (!value) return null;
  if (Object.hasOwn(question.options, value)) return value;
  if (!question.freeText) return null;
  return value.slice(0, ANSWER_MAX);
}

/** How an answer reads to the model: the option's meaning or the user's own words, quoted. */
export function answerForModel(question: JarvisQuestion, answer: string): string {
  return Object.hasOwn(question.options, answer)
    ? question.options[answer]!
    : JSON.stringify(answer);
}
