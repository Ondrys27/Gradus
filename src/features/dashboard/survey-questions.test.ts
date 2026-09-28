import { describe, expect, it } from "vitest";
import {
  answeredCount,
  cleanAnswers,
  SURVEY_QUESTIONS,
  TEXT_MAX,
  toggleOption,
  type SurveyQuestion,
} from "./survey-questions";

describe("the survey", () => {
  it("asks between eight and twelve questions with unique keys", () => {
    expect(SURVEY_QUESTIONS.length).toBeGreaterThanOrEqual(8);
    expect(SURVEY_QUESTIONS.length).toBeLessThanOrEqual(12);
    expect(new Set(SURVEY_QUESTIONS.map((question) => question.key)).size).toBe(
      SURVEY_QUESTIONS.length,
    );
  });
});

describe("cleanAnswers", () => {
  it("keeps valid answers and drops unknown questions, unknown options and empty text", () => {
    const clean = cleanAnswers({
      duration: "from30to60",
      format: "carrierPigeon",
      attendees: ["owner", "nobody", "finance"],
      mood: 4,
      interest: 9,
      confidence: 2.5,
      whatDidntWork: "   ",
      notes: "  They liked the demo.  ",
      injected: "x",
    });
    expect(clean).toEqual({
      duration: "from30to60",
      attendees: ["owner", "finance"],
      mood: 4,
      notes: "They liked the demo.",
    });
    expect(answeredCount(clean)).toBe(4);
  });

  it("cuts long text and treats anything that is not an object as empty", () => {
    expect((cleanAnswers({ notes: "x".repeat(TEXT_MAX + 50) }).notes as string).length).toBe(
      TEXT_MAX,
    );
    expect(cleanAnswers(null)).toEqual({});
    expect(cleanAnswers([])).toEqual({});
    expect(cleanAnswers("text")).toEqual({});
  });
});

describe("toggleOption", () => {
  const objections = SURVEY_QUESTIONS.find(
    (question): question is Extract<SurveyQuestion, { type: "multi" }> =>
      question.key === "objections",
  )!;

  it("adds and removes an option", () => {
    expect(toggleOption(objections, [], "price")).toEqual(["price"]);
    expect(toggleOption(objections, ["price", "timing"], "price")).toEqual(["timing"]);
  });

  it("lets 'no objections' stand alone", () => {
    expect(toggleOption(objections, ["price", "timing"], "none")).toEqual(["none"]);
    expect(toggleOption(objections, ["none"], "price")).toEqual(["price"]);
  });
});
