import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_SETTINGS } from "@/lib/format";
import { answerErrors, answersToSave, initialAnswers, shownFields } from "./move-form";
import type { ContactField } from "./types";

function field(id: string, patch: Partial<ContactField> = {}): ContactField {
  return {
    id,
    table_id: "t",
    label: id,
    type: "text",
    required: false,
    options: null,
    default_value: null,
    depends_on_field_id: null,
    depends_on_value: null,
    position: 0,
    system_key: null,
    ...patch,
  };
}

const reason = field("reason", {
  type: "select",
  required: true,
  options: [
    { key: "not_interested", label: "Not interested" },
    { key: "other", label: "Other" },
  ],
  position: 0,
});
const why = field("why", {
  type: "long_text",
  required: true,
  depends_on_field_id: "reason",
  depends_on_value: "not_interested",
  position: 1,
});
const deeper = field("deeper", {
  depends_on_field_id: "why",
  depends_on_value: "x",
  position: 2,
});
const fields = [why, reason, deeper];

describe("shownFields", () => {
  it("shows dependants only for the answer they wait for", () => {
    expect(shownFields(fields, {}).map((f) => f.id)).toEqual(["reason"]);
    expect(shownFields(fields, { reason: "not_interested" }).map((f) => f.id)).toEqual([
      "reason",
      "why",
    ]);
    expect(shownFields(fields, { reason: "other", why: "x" }).map((f) => f.id)).toEqual(["reason"]);
  });

  it("hides a dependant whose question is gone", () => {
    const orphan = field("orphan", { depends_on_field_id: "missing", depends_on_value: "a" });
    expect(shownFields([orphan], {})).toEqual([]);
  });
});

describe("answers", () => {
  it("checks only shown questions", () => {
    expect(answerErrors(fields, {})).toEqual({ reason: "required" });
    expect(answerErrors(fields, { reason: "not_interested", why: "  " })).toEqual({
      why: "required",
    });
    expect(answerErrors(fields, { reason: "made_up" })).toEqual({ reason: "invalid" });
    expect(answerErrors(fields, { reason: "other" })).toEqual({});
  });

  it("sends trimmed answers of shown questions only", () => {
    expect(answersToSave(fields, { reason: "other", why: "hidden", deeper: "hidden too" })).toEqual(
      { reason: "other" },
    );
    expect(answersToSave(fields, { reason: "not_interested", why: "  price  " })).toEqual({
      reason: "not_interested",
      why: "price",
    });
  });

  it("checks dates, times and yes/no by type", () => {
    const list = [
      field("d", { type: "date" }),
      field("dt", { type: "datetime" }),
      field("b", { type: "boolean", required: true }),
    ];
    expect(answerErrors(list, { d: "24. 9. 2026", dt: "soon", b: false })).toEqual({
      d: "invalid",
      dt: "invalid",
    });
    expect(answerErrors(list, {})).toEqual({ b: "required" });
  });

  it("prefills today in the user's zone", () => {
    const sentOn = field("sent", { type: "date", default_value: "today" });
    const late = new Date("2026-09-24T23:30:00Z");
    expect(initialAnswers([sentOn], DEFAULT_FORMAT_SETTINGS, late)).toEqual({ sent: "2026-09-25" });
  });
});
