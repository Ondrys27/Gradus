import { describe, expect, it } from "vitest";
import { ADMIN_PATH } from "@/features/admin/access";
import { UI_MAP_BY_KEY } from "../ui-map";
import { doableFor, navigationFor, nextIndex, stepDone, toGuideSteps, type GuideStep, type ScreenState } from "./player";
import { guideSectionOf, onPage } from "./sections";

const QUIET: ScreenState = {
  pathname: "/app",
  search: "",
  pressed: false,
  typed: false,
  nextVisible: false,
  targetGone: false,
  saved: false,
};

const steps = toGuideSteps(
  [
    { key: "pipeline-new-deal", action: "go" },
    { key: "pipeline-new-deal", action: "click" },
    { key: "deal-form", action: "fill" },
    { key: "deal-create", action: "wait", say: "Ulož obchod." },
  ],
  UI_MAP_BY_KEY,
  "run",
);

describe("the guide's player", () => {
  it("leads to the element's page and lights the section's menu item on a go step", () => {
    expect(steps[0]).toMatchObject({
      action: "go",
      path: "/app/pipeline",
      highlight: ["nav-pipeline"],
      titleKey: "guides.pipeline.name",
      textKey: "guide.goTo",
      doable: true,
    });
    expect(steps[1]).toMatchObject({ highlight: ["pipeline-new-deal"], titleKey: "ui.pipeline-new-deal.name" });
    expect(steps[3]!.say).toBe("Ulož obchod.");
  });

  it("names the next element as what a step opens, never across a go", () => {
    expect(steps[0]!.nextKey).toBe("pipeline-new-deal");
    expect(steps[1]!.nextKey).toBe("deal-form");
    expect(steps[2]!.nextKey).toBe("deal-create");
    expect(steps[3]!.nextKey).toBeUndefined();
    const crossing = toGuideSteps(
      [
        { key: "contact-new", action: "click" },
        { key: "pipeline-new-deal", action: "go" },
      ],
      UI_MAP_BY_KEY,
      "x",
    );
    expect(crossing[0]!.nextKey).toBeUndefined();
  });

  it("drops a key the catalog does not have", () => {
    expect(toGuideSteps([{ key: "made-up", action: "click" }], UI_MAP_BY_KEY, "x")).toEqual([]);
  });

  it("is done by what is on the screen", () => {
    const [go, click, fill, wait] = steps as [GuideStep, GuideStep, GuideStep, GuideStep];
    expect(stepDone(go, QUIET)).toBe(false);
    expect(stepDone(go, { ...QUIET, pathname: "/app/pipeline" })).toBe(true);
    expect(stepDone(click, QUIET)).toBe(false);
    expect(stepDone(click, { ...QUIET, pressed: true })).toBe(true);
    expect(stepDone(click, { ...QUIET, nextVisible: true })).toBe(true);
    expect(stepDone(fill, { ...QUIET, pressed: true })).toBe(false);
    expect(stepDone(fill, { ...QUIET, typed: true })).toBe(true);
    expect(stepDone(wait, QUIET)).toBe(false);
    expect(stepDone(wait, { ...QUIET, saved: true })).toBe(true);
    expect(stepDone(wait, { ...QUIET, targetGone: true })).toBe(true);
    expect(stepDone({ ...click, action: "highlight" }, QUIET)).toBe(true);
  });

  it("does it for the user only where it is safe: leading somewhere, pressing what only opens", () => {
    expect(doableFor("go", undefined)).toBe(true);
    expect(doableFor("click", UI_MAP_BY_KEY.get("pipeline-new-deal"))).toBe(true);
    expect(doableFor("click", UI_MAP_BY_KEY.get("deal-create"))).toBe(false);
    expect(doableFor("fill", UI_MAP_BY_KEY.get("deal-form"))).toBe(false);
    expect(doableFor("wait", UI_MAP_BY_KEY.get("deal-create"))).toBe(false);
    expect(doableFor("click", UI_MAP_BY_KEY.get("invoice-issue"))).toBe(false);
  });

  it("opens the step's page, but not for an element inside a detail under it", () => {
    const [, click] = steps as [GuideStep, GuideStep];
    expect(navigationFor(click, "/app", "")).toBe("/app/pipeline");
    expect(navigationFor(click, "/app/pipeline", "tile=overdue")).toBeNull();
    const download = toGuideSteps([{ key: "invoice-download", action: "highlight" }], UI_MAP_BY_KEY, "x")[0]!;
    expect(download.inside).toBe(true);
    expect(navigationFor(download, "/app/finance/faktury/abc", "")).toBeNull();
    expect(navigationFor(download, "/app/kontakty", "")).toBe(download.path);
    const panel = toGuideSteps([{ key: "grady-input", action: "fill" }], UI_MAP_BY_KEY, "x")[0]!;
    expect(navigationFor(panel, "/app/kontakty", "")).toBeNull();
  });

  it("ends after the last step", () => {
    expect(nextIndex(0, 3)).toBe(1);
    expect(nextIndex(2, 3)).toBe("end");
  });
});

describe("pages and sections", () => {
  it("knows whose guide a page is", () => {
    expect(guideSectionOf("/app")).toBe("dashboard");
    expect(guideSectionOf("/app/pipeline")).toBe("pipeline");
    expect(guideSectionOf("/app/finance", "tab=invoices")).toBe("invoices");
    expect(guideSectionOf("/app/finance/faktury/123")).toBe("invoices");
    expect(guideSectionOf("/app/finance", "tab=month")).toBe("finance");
    expect(guideSectionOf("/app/firma", "tab=rewards")).toBe("rewards");
    expect(guideSectionOf("/app/odmeny")).toBe("rewards");
    expect(guideSectionOf("/app/nastaveni/grady")).toBe("grady");
    expect(guideSectionOf("/app/nastaveni/integrace")).toBe("connectedApps");
    expect(guideSectionOf("/app/nastaveni/vzhled")).toBe("settings");
    expect(guideSectionOf("/app/ukoly")).toBe("tasks");
    expect(guideSectionOf("/app/pozvanky")).toBeNull();
    expect(guideSectionOf(ADMIN_PATH)).toBe("adminOverview");
    expect(guideSectionOf(`${ADMIN_PATH}/uzivatele/1`)).toBe("adminPeople");
    expect(guideSectionOf(`${ADMIN_PATH}/tarify`)).toBe("adminSettings");
  });

  it("matches a page with its tab", () => {
    expect(onPage("/app/finance?tab=invoices", "/app/finance", "tab=invoices&page=2")).toBe(true);
    expect(onPage("/app/finance?tab=invoices", "/app/finance", "tab=month")).toBe(false);
    expect(onPage("/app", "/app/pipeline")).toBe(false);
    expect(onPage("/app/pipeline", "/app/pipeline/")).toBe(true);
  });
});
