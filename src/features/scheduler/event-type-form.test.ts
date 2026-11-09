import { describe, expect, it } from "vitest";
import {
  draftIssues,
  draftToRow,
  moveItem,
  newQuestion,
  parseQuestions,
  parseReminders,
  pickEventType,
  type EventTypeDraft,
} from "./event-type-form";
import { DEFAULT_QUESTIONS, DEFAULT_REMINDERS } from "./types";

const DRAFT: EventTypeDraft = {
  name: "Konzultace",
  slug: "konzultace",
  description: null,
  duration_min: 30,
  location_kind: "video",
  location_text: null,
  color: "violet",
  requires_approval: false,
  buffer_before_min: 0,
  buffer_after_min: 0,
  min_notice_hours: 4,
  max_days_ahead: 60,
  max_per_day: null,
  slot_step_min: 30,
  custom_availability: false,
  questions: DEFAULT_QUESTIONS.map((question) => ({ ...question })),
  reminders: DEFAULT_REMINDERS.map((reminder) => ({ ...reminder })),
  deal_stage_id: null,
  confirmation_note: null,
};

describe("parsing", () => {
  it("keeps name and e-mail whatever the database holds", () => {
    expect(parseQuestions(null).map((q) => q.key)).toEqual(["name", "email", "phone", "company"]);
    const odd = parseQuestions([
      { key: "budget", label: "Budget", type: "text", required: true },
      { nope: 1 },
    ]);
    expect(odd.map((q) => q.key)).toEqual(["name", "email", "budget"]);
    expect(parseReminders([{ offset_minutes: 60, channel: "email" }, { x: 1 }])).toEqual([
      { offset_minutes: 60, channel: "email" },
    ]);
  });
});

describe("draftIssues", () => {
  it("passes the defaults", () => {
    expect(draftIssues(DRAFT)).toEqual([]);
  });

  it("finds what the database would refuse", () => {
    const codes = (draft: Partial<EventTypeDraft>, slugs: string[] = []) =>
      draftIssues({ ...DRAFT, ...draft }, slugs).map((issue) => `${issue.field}:${issue.code}`);
    expect(codes({ name: "  " })).toEqual(["name:required"]);
    expect(codes({}, ["konzultace"])).toEqual(["slug:taken"]);
    expect(codes({ slug: "Bad Slug" })).toEqual(["slug:format"]);
    expect(codes({ location_kind: "in_person", location_text: "" })).toEqual([
      "location_text:required",
    ]);
    expect(codes({ duration_min: 3 })).toEqual(["duration_min:range"]);
    expect(codes({ max_days_ahead: 61 })).toEqual(["horizon:range"]);
    expect(codes({ slot_step_min: 20 })).toEqual(["step:range"]);
    expect(codes({ max_per_day: 0 })).toEqual(["perDay:range"]);
    expect(codes({ questions: DRAFT.questions.filter((q) => q.key !== "email") })).toEqual([
      "questions:locked",
    ]);
    expect(codes({ questions: [...DRAFT.questions, newQuestion(DRAFT.questions)] })).toEqual([
      "questions:label",
    ]);
    expect(
      codes({
        questions: [
          ...DRAFT.questions,
          { ...newQuestion(DRAFT.questions, "select"), label: "Size" },
        ],
      }),
    ).toEqual(["questions:options"]);
    expect(
      codes({
        reminders: [
          { offset_minutes: 60, channel: "email" },
          { offset_minutes: 60, channel: "email" },
        ],
      }),
    ).toEqual(["reminders:duplicate"]);
    expect(codes({ reminders: [{ offset_minutes: 2, channel: "email" }] })).toEqual([
      "reminders:range",
    ]);
    expect(
      codes({
        reminders: [10, 15, 30, 60, 120, 240].map((offset_minutes) => ({
          offset_minutes,
          channel: "email" as const,
        })),
      }),
    ).toEqual(["reminders:tooMany"]);
  });

  it("writes the row the database expects", () => {
    const row = draftToRow({
      ...DRAFT,
      name: " Konzultace ",
      description: "  ",
      location_text: "ignored",
      questions: [
        ...DRAFT.questions,
        {
          key: "q5",
          label: " Size ",
          type: "select",
          required: false,
          options: [" 1–5 ", "", "6+"],
        },
      ],
      reminders: [
        { offset_minutes: 60, channel: "email" },
        { offset_minutes: 1440, channel: "email" },
      ],
    });
    expect(row.name).toBe("Konzultace");
    expect(row.description).toBeNull();
    expect(row.location_text).toBeNull();
    expect((row.questions as Array<Record<string, unknown>>).at(-1)).toEqual({
      key: "q5",
      label: "Size",
      type: "select",
      required: false,
      options: ["1–5", "6+"],
    });
    expect(row.reminders).toEqual([
      { offset_minutes: 1440, channel: "email" },
      { offset_minutes: 60, channel: "email" },
    ]);
  });

  it("moves items", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
  });
});

describe("pickEventType", () => {
  const types = [
    { id: "a", active: true, duration_min: 60, position: 2 },
    { id: "b", active: true, duration_min: 30, position: 1 },
    { id: "c", active: true, duration_min: 15, position: 0 },
    { id: "d", active: false, duration_min: 10, position: 3 },
  ];
  it("an intro is the shortest active, a meeting the one closest to 30 minutes", () => {
    expect(pickEventType(types, "intro")?.id).toBe("c");
    expect(pickEventType(types, "meeting")?.id).toBe("b");
    expect(
      pickEventType(
        types.filter((t) => t.id === "a" || t.id === "c"),
        "meeting",
      )?.id,
    ).toBe("c");
    expect(pickEventType([types[3]], "intro")).toBeNull();
  });
});
