import { describe, expect, it } from "vitest";
import type { Question } from "../types";
import { answerLines, checkAnswers } from "./answers";

const QUESTIONS: Question[] = [
  { key: "name", label: null, type: "text", required: true },
  { key: "email", label: null, type: "email", required: true },
  { key: "phone", label: null, type: "phone", required: true },
  { key: "company", label: null, type: "text", required: false },
  { key: "goal", label: "Co chcete probrat?", type: "textarea", required: false },
  { key: "size", label: "Velikost týmu", type: "select", required: true, options: ["1–5", "6–20"] },
  { key: "terms", label: "Souhlasím", type: "checkbox", required: true },
];

describe("the guest's answers", () => {
  it("become the guest columns and the type's own answers", () => {
    const checked = checkAnswers(
      QUESTIONS,
      {
        name: "  Jan   Novák ",
        email: "Jan@Example.COM",
        phone: "777 123 456",
        company: "Novák s.r.o.",
        goal: "Web",
        size: "6–20",
        terms: true,
        extra: "ignored",
      },
      "CZ",
    );
    expect(checked).toEqual({
      ok: true,
      guest: { name: "Jan Novák", email: "jan@example.com", phone: "+420777123456", company: "Novák s.r.o." },
      answers: { goal: "Web", size: "6–20", terms: true },
    });
  });

  it("names what is missing or wrong", () => {
    const checked = checkAnswers(QUESTIONS, { email: "nope", phone: "12", size: "100+", goal: "x".repeat(2001) }, "CZ");
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.errors).toEqual({
      name: "required",
      email: "invalid",
      phone: "invalid",
      size: "invalid",
      goal: "tooLong",
      terms: "required",
    });
  });

  it("always asks for name and e-mail, whatever the stored questions say", () => {
    const checked = checkAnswers([], {}, null);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(Object.keys(checked.errors).sort()).toEqual(["email", "name"]);
  });

  it("an optional phone may stay empty", () => {
    const checked = checkAnswers(
      [
        { key: "name", label: null, type: "text", required: true },
        { key: "email", label: null, type: "email", required: true },
        { key: "phone", label: null, type: "phone", required: false },
      ],
      { name: "Eva", email: "eva@example.com", phone: "" },
      "CZ",
    );
    expect(checked).toMatchObject({ ok: true, guest: { phone: null } });
  });

  it("are listed for the host by the type's labels", () => {
    expect(
      answerLines(QUESTIONS, { goal: "Web", terms: false, size: "1–5", name: "x" }, { yes: "ano", no: "ne" }),
    ).toEqual(["Co chcete probrat?: Web", "Velikost týmu: 1–5", "Souhlasím: ne"]);
  });
});
