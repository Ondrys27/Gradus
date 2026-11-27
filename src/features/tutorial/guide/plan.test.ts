import { describe, expect, it } from "vitest";
import { UI_MAP_BY_KEY } from "../ui-map";
import { GUIDE_MAX_STEPS, planFromAnswer, type GuideModelAnswer } from "./plan";
import { FULL_ADMIN, LIMITED_ADMIN, OWNER, SALES, VIEWER } from "./test-audiences";

const plan = (answer: GuideModelAnswer, audience = OWNER, section: Parameters<typeof planFromAnswer>[1]["section"] = "dashboard") =>
  planFromAnswer(answer, { elements: UI_MAP_BY_KEY, audience, section });
const seq = (result: ReturnType<typeof plan>) => result.steps.map((step) => `${step.action}:${step.key}`);

describe("Grady's answer as steps", () => {
  it("leads into the element's section first and keeps the order", () => {
    const result = plan({
      kind: "steps",
      answer: "Obchod přidáš v Pipeline.",
      steps: [
        { key: "pipeline-new-deal", action: "click" },
        { key: "deal-form", action: "fill" },
        { key: "deal-create", action: "wait" },
      ],
    });
    expect(result.kind).toBe("steps");
    expect(seq(result)).toEqual([
      "go:pipeline-new-deal",
      "click:pipeline-new-deal",
      "fill:deal-form",
      "wait:deal-create",
    ]);
  });

  it("needs no leading inside the section the person is in", () => {
    const result = plan({ kind: "steps", answer: "x", steps: [{ key: "pipeline-new-deal", action: "click" }] }, OWNER, "pipeline");
    expect(seq(result)).toEqual(["click:pipeline-new-deal"]);
  });

  it("drops keys the catalog does not have and families, and says so", () => {
    const result = plan({
      kind: "steps",
      answer: "x",
      steps: [
        { key: "made-up-button", action: "click" },
        { key: "widget-", action: "highlight" },
        { key: "contact-new", action: "click" },
      ],
    });
    expect(result.dropped).toBe(2);
    expect(seq(result)).toEqual(["go:contact-new", "click:contact-new"]);
  });

  it("answers in words when no step is left", () => {
    const result = plan({ kind: "steps", answer: "Popíšu to slovy.", steps: [{ key: "nope", action: "click" }] });
    expect(result).toMatchObject({ kind: "words", steps: [], dropped: 1 });
  });

  it("puts in front what has to be opened first", () => {
    const result = plan(
      { kind: "steps", answer: "x", steps: [{ key: "deal-tasks", action: "highlight" }] },
      OWNER,
      "pipeline",
    );
    expect(seq(result)).toEqual(["open:deal-card", "highlight:deal-tasks"]);
  });

  it("never points at what the person may not open: no right instead", () => {
    const result = plan(
      { kind: "steps", answer: "Fakturu vystavíš…", steps: [{ key: "invoice-new", action: "click" }] },
      SALES,
    );
    expect(result).toMatchObject({ kind: "noRight", steps: [], blockedSections: ["invoices"] });
  });

  it("believes no right only with nothing playable left", () => {
    const result = plan({ kind: "no_right", answer: "x", steps: [{ key: "pipeline-new-deal", action: "click" }] }, SALES);
    expect(result.kind).toBe("steps");
    const viewer = plan({ kind: "steps", answer: "x", steps: [{ key: "contact-new", action: "click" }] }, VIEWER, "contacts");
    expect(viewer.kind).toBe("noRight");
  });

  it("keeps chat, missing and words without steps", () => {
    for (const kind of ["chat", "missing", "words"] as const) {
      const result = plan({ kind, answer: "x", steps: [{ key: "contact-new", action: "click" }] });
      expect(result.kind).toBe(kind);
      expect(result.steps).toEqual([]);
    }
  });

  it("fills only a field; an unknown action of a field is fill, of a button highlight", () => {
    const result = plan(
      {
        kind: "steps",
        answer: "x",
        steps: [
          { key: "contact-search", action: "type" },
          { key: "contact-new", action: "fill" },
          { key: "contact-generate", action: "dance" },
        ],
      },
      OWNER,
      "contacts",
    );
    expect(seq(result)).toEqual(["fill:contact-search", "click:contact-new", "highlight:contact-generate"]);
  });

  it("ends a plan that only leads somewhere on the element itself", () => {
    const result = plan({ kind: "steps", answer: "x", steps: [{ key: "finance-tabs", action: "go" }] });
    expect(seq(result)).toEqual(["go:finance-tabs", "highlight:finance-tabs"]);
  });

  it("never needs leading to Grady's panel, it is on every page", () => {
    const result = plan({ kind: "steps", answer: "x", steps: [{ key: "grady-input", action: "fill" }] });
    expect(seq(result)).toEqual(["open:grady-button", "fill:grady-input"]);
  });

  it("is at most ten steps and cuts long texts", () => {
    const result = plan({
      kind: "steps",
      answer: "a ".repeat(800),
      steps: Array.from({ length: 30 }, (_, index) => ({
        key: index % 2 ? "contact-new" : "pipeline-new-deal",
        action: "click",
        say: "b".repeat(300),
      })),
    });
    expect(result.steps.length).toBeLessThanOrEqual(GUIDE_MAX_STEPS);
    expect(result.answer.length).toBeLessThanOrEqual(600);
    for (const step of result.steps) expect((step.say ?? "").length).toBeLessThanOrEqual(160);
  });

  it("gives an administrator only the administration's powers", () => {
    const answer: GuideModelAnswer = {
      kind: "steps",
      answer: "x",
      steps: [
        { key: "admin-users-row", action: "click" },
        { key: "admin-user-subscription", action: "highlight" },
      ],
    };
    expect(seq(plan(answer, FULL_ADMIN, "adminPeople"))).toEqual([
      "click:admin-users-row",
      "highlight:admin-user-subscription",
    ]);
    expect(seq(plan(answer, LIMITED_ADMIN, "adminPeople"))).toEqual(["click:admin-users-row"]);
    expect(plan({ kind: "steps", answer: "x", steps: [{ key: "contact-new", action: "click" }] }, FULL_ADMIN).kind).toBe(
      "noRight",
    );
  });
});
