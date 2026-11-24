import { describe, expect, it } from "vitest";
import {
  ALL_TOPICS,
  chatTopics,
  leftOutSections,
  plansCatalogNeeded,
  situationSections,
} from "./chat-context";

describe("the chat's context cut to the message", () => {
  it("keeps everything for the day, a plan, advice or a message about nothing in particular", () => {
    expect(chatTopics(["Co mám dneska dělat?"])).toBe(ALL_TOPICS);
    expect(chatTopics(["Naplánuj mi den"])).toBe(ALL_TOPICS);
    expect(chatTopics(["Ahoj!"])).toBe(ALL_TOPICS);
    expect(chatTopics([])).toBe(ALL_TOPICS);
  });

  it("finds the topics without diacritics and from the two messages before", () => {
    const topics = chatTopics(["Pošli mi seznam faktur po splatnosti"]);
    expect(topics).not.toBe(ALL_TOPICS);
    expect([...(topics as Set<string>)]).toEqual(["invoices"]);
    const follow = chatTopics(["a ten dražší?", "Kolik stojí tarif Pro?"]);
    expect(follow !== ALL_TOPICS && follow.has("plans")).toBe(true);
    // A stem only at the start of a word: "kontakt" does not hide in "nekontaktní".
    expect(chatTopics(["obchod s Pekárnou"])).not.toBe(ALL_TOPICS);
  });

  it("lists only the matching parts of the situation and says what it left out", () => {
    const sections = situationSections(new Set(["invoices"]));
    expect([...(sections ?? [])].sort()).toEqual(["finance", "invoices"]);
    expect(leftOutSections(sections)).toContain("calendar");
    expect(situationSections(ALL_TOPICS)).toBeNull();
    expect(leftOutSections(null)).toEqual([]);
  });

  it("adds the plan catalog only about plans, or when a payment failed", () => {
    expect(plansCatalogNeeded(new Set(["pipeline"]), "The user's own plan: Pro.")).toBe(false);
    expect(plansCatalogNeeded(new Set(["plans"]), null)).toBe(true);
    expect(plansCatalogNeeded(ALL_TOPICS, null)).toBe(true);
    expect(
      plansCatalogNeeded(new Set(["pipeline"]), "The last payment failed (past due): Stripe retries it."),
    ).toBe(true);
  });
});
