import { describe, expect, it } from "vitest";
import { sectionGuide, SECTION_GUIDES, UI_MAP_BY_KEY } from "../ui-map";
import { elementAllowed } from "../ui-map/access";
import { sectionGuideSteps, type GuideDepth } from "./section-guide";
import { FULL_ADMIN, LIMITED_ADMIN, OWNER, SALES, VIEWER, workerWith } from "./test-audiences";

const run = (section: Parameters<typeof sectionGuide>[0], depth: GuideDepth, audience = OWNER, writable = true) =>
  sectionGuideSteps({
    guide: sectionGuide(section)!,
    depth,
    audience,
    elements: UI_MAP_BY_KEY,
    writable,
    runId: "t",
  });

describe("the guide of a section", () => {
  it("starts with the section's own word, then only looks in the quick look", () => {
    for (const guide of SECTION_GUIDES) {
      const audience = guide.section.startsWith("admin") ? FULL_ADMIN : OWNER;
      const steps = run(guide.section, "quick", audience);
      expect(steps[0]).toMatchObject({ key: `intro-${guide.section}`, textKey: `guides.${guide.section}.intro` });
      expect(steps.length, guide.section).toBeGreaterThanOrEqual(4);
      expect(steps.every((step) => step.action === "highlight"), guide.section).toBe(true);
      expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
    }
  });

  it("lets the owner try things in the full guide and opens what is inside first", () => {
    const steps = run("pipeline", "full");
    const keys = steps.map((step) => step.key);
    expect(steps.some((step) => step.action === "click" || step.action === "fill")).toBe(true);
    // A deal's tabs come after the deal is opened, and after everything on the board.
    expect(keys.indexOf("deal-card")).toBeLessThan(keys.indexOf("deal-history"));
    expect(keys.indexOf("pipeline-health")).toBeLessThan(keys.indexOf("deal-history"));
    expect(steps.find((step) => step.key === "deal-history")?.inside).toBe(true);
  });

  it("only looks in a read-only space", () => {
    const steps = run("contacts", "full", OWNER, false);
    expect(steps.filter((step) => step.action === "click" || step.action === "fill")).toEqual([]);
  });

  it("leaves out what the person may not use (30.2)", () => {
    for (const guide of SECTION_GUIDES.filter((entry) => !entry.section.startsWith("admin"))) {
      for (const audience of [SALES, VIEWER]) {
        for (const step of run(guide.section, "full", audience)) {
          if (step.key.startsWith("intro-")) continue;
          expect(elementAllowed(UI_MAP_BY_KEY.get(step.key)!, audience), `${guide.section}: ${step.key}`).toBe(true);
        }
      }
    }
    const pipeline = run("pipeline", "full", SALES).map((step) => step.key);
    expect(pipeline).toContain("pipeline-new-deal");
    expect(pipeline).not.toContain("deal-delete");
    expect(pipeline).not.toContain("deal-create-invoice");
    // A worker with finance to look at sees the plan, not how to change it.
    const finance = run("finance", "full", workerWith({ finance: ["view"] })).map((step) => step.key);
    expect(finance).toContain("plan-grid");
    expect(finance).not.toContain("plan-create-month");
    expect(finance).not.toContain("finance-overview");
    // A worker without the section gets only the opening word.
    expect(run("finance", "full", SALES)).toHaveLength(1);
  });

  it("gives a limited administrator no step on what only a full one may do", () => {
    const keys = run("adminPeople", "full", LIMITED_ADMIN).map((step) => step.key);
    expect(keys).toContain("admin-users-row");
    expect(keys).not.toContain("admin-user-subscription");
    expect(keys).not.toContain("admin-users-export");
    expect(run("adminPeople", "full", FULL_ADMIN).map((step) => step.key)).toContain("admin-user-subscription");
  });

  it("names, for each step, the next one as what it opens", () => {
    const steps = run("messages", "full");
    for (let index = 0; index < steps.length - 1; index += 1) {
      expect(steps[index]!.nextKey).toBe(steps[index + 1]!.key);
    }
  });
});
