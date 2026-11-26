import { describe, expect, it } from "vitest";
import { can, workspaceFor } from "@/features/account/workspace";
import {
  PERMISSION_TEMPLATES,
  templateGrants,
  type GrantSection,
  type PermissionGrants,
  type PermissionTemplate,
} from "@/features/workers/permissions-catalog";
import { newSections } from "./access-offer";
import type { TutorialCheckKey } from "./checks";
import {
  accessTourSteps,
  tutorialSectionsOf,
  tutorialSteps,
  workerNavKeys,
  type TutorialAudience,
  type TutorialStep,
} from "./steps";
import type { RunningMode } from "./types";

/**
 * The right each hands-on check proves the user has (30.2), stated apart from
 * the steps: a step that asks for it must never reach a worker without it.
 */
const CHECK_NEEDS: Partial<Record<TutorialCheckKey, readonly [GrantSection, string]>> = {
  milestoneCreated: ["milestones", "update"],
  taskCreated: ["milestones", "update"],
  taskMoved: ["milestones", "update"],
  contactCreated: ["contacts", "create"],
  contactMoved: ["cold_calling", "call"],
  dealCreated: ["pipeline", "create"],
  closeDateSet: ["pipeline", "update"],
  dealTaskCreated: ["tasks", "create"],
  invoiceCreated: ["invoices", "issue"],
};

/** Rights as the database hands them to the app: the defaults (own tasks, branch) included. */
function worker(template: PermissionTemplate, playing = false): TutorialAudience {
  return { worker: true, playing, grants: templateGrants(template) };
}

const keysOf = (steps: TutorialStep[]) => steps.map((step) => step.key);
const sectionsOf = (steps: TutorialStep[]) => new Set(steps.map((step) => step.section));

const ROLES = ["sales", "assistant", "accountant", "coldCaller"] as const;
const OWNER: TutorialAudience = { worker: false, playing: false };

describe("a tutorial by rights", () => {
  it("is different for every role and for the owner, in both modes", () => {
    for (const mode of ["quick", "full"] as RunningMode[]) {
      const lists = [OWNER, ...ROLES.map((role) => worker(role))].map((audience) =>
        keysOf(tutorialSteps(mode, audience)).join(","),
      );
      expect(new Set(lists).size, mode).toBe(lists.length);
    }
  });

  it.each(PERMISSION_TEMPLATES.filter((template) => template !== "all"))(
    "never points %s at what they cannot open or do",
    (template) => {
      const audience = worker(template, true);
      const workspace = workspaceFor("w", { id: "worker", ownerId: "owner" }, audience.grants);
      const menu = workerNavKeys(workspace);
      for (const mode of ["quick", "full"] as RunningMode[]) {
        for (const step of tutorialSteps(mode, audience)) {
          if (step.section !== "grady" && step.section !== "settings") {
            expect(menu.has(step.section), `${mode} ${step.key} → ${step.section}`).toBe(true);
          }
          for (const target of step.highlight) {
            if (target.startsWith("nav-")) expect(menu.has(target.slice(4) as never), `${step.key} ${target}`).toBe(true);
          }
          if (step.action === "do") {
            const need = CHECK_NEEDS[step.checkKey];
            if (need) expect(can(workspace, need[0], need[1] as never), `${template} ${step.key}`).toBe(true);
          }
        }
      }
    },
  );

  it("teaches a cold caller Cold Calling, tasks, rewards and messages, never money or deals", () => {
    for (const mode of ["quick", "full"] as RunningMode[]) {
      const sections = sectionsOf(tutorialSteps(mode, worker("coldCaller")));
      for (const section of ["coldCalling", "tasks", "myRewards", "messages"] as const) {
        expect(sections.has(section), `${mode} ${section}`).toBe(true);
      }
      for (const section of ["finance", "pipeline", "milestones", "calendar", "contacts"] as const) {
        expect(sections.has(section), `${mode} ${section}`).toBe(false);
      }
    }
    const full = keysOf(tutorialSteps("full", worker("coldCaller")));
    expect(full).toContain("coldCallingMove");
    expect(full).not.toContain("contactCreate");
    expect(full).not.toContain("invoiceDraft");
  });

  it("lets an accountant try a draft invoice, and a salesperson deals but no invoice", () => {
    const accountant = keysOf(tutorialSteps("full", worker("accountant")));
    expect(accountant).toContain("invoiceDraft");
    expect(accountant).not.toContain("dealFromContact");
    expect(accountant).not.toContain("coldCallingLook");
    const sales = keysOf(tutorialSteps("full", worker("sales")));
    expect(sales).toEqual(expect.arrayContaining(["contactCreate", "dealFromContact", "dealCloseDate", "dealTask"]));
    expect(sales).not.toContain("invoiceDraft");
    expect(sales).not.toContain("milestoneCreate");
    const assistant = keysOf(tutorialSteps("full", worker("assistant")));
    expect(assistant).toEqual(expect.arrayContaining(["milestoneCreate", "taskAdd", "calendarLook"]));
    expect(assistant).not.toContain("financeLook");
  });

  it("starts by saying who they work for and ends on their own tasks; the owner's start and end stay", () => {
    for (const role of ROLES) {
      expect(tutorialSteps("quick", worker(role))[0]?.key).toBe("workerWelcome");
      expect(tutorialSteps("full", worker(role))[0]?.key).toBe("workerWelcomeFull");
      expect(tutorialSteps("full", worker(role)).at(-1)?.key).toBe("workerFinish");
    }
    expect(tutorialSteps("full", OWNER)[0]?.key).toBe("welcome");
    expect(keysOf(tutorialSteps("full", OWNER))).toContain("jarvisFrequency");
    expect(keysOf(tutorialSteps("full", worker("sales")))).not.toContain("jarvisFrequency");
  });

  it("allows no hands-on step in a read-only company, only looking", () => {
    const steps = tutorialSteps("full", { ...worker("all"), readOnly: true });
    const doing = steps.filter((step) => step.action === "do").map((step) => step.key);
    expect(doing).toEqual([]);
    expect(steps.length).toBeGreaterThan(10);
  });
});

describe("new access", () => {
  it("names the sections a worker was not introduced to, in menu order, once", () => {
    const before = tutorialSectionsOf(worker("coldCaller"));
    const grown: PermissionGrants = {
      ...templateGrants("coldCaller"),
      finance: ["view", "summaries"],
      invoices: ["view"],
    };
    const after = tutorialSectionsOf({ worker: true, playing: false, grants: grown });
    expect(newSections(before, after)).toEqual(["finance"]);
    expect(newSections([...before, "finance"], after)).toEqual([]);
  });

  it("shows just those sections, then a closing word", () => {
    const grown: PermissionGrants = { ...templateGrants("coldCaller"), finance: ["view"] };
    const tour = accessTourSteps({ worker: true, playing: false, grants: grown }, ["finance"]);
    expect(keysOf(tour)).toEqual(["workerFinance", "accessFinish"]);
    expect(tour.every((step) => step.action === "look")).toBe(true);
    expect(accessTourSteps(worker("coldCaller"), [])).toEqual([]);
  });
});

describe("checks in a company", () => {
  it("count only what the worker did, and their own notes there", async () => {
    const { checkQuery, TUTORIAL_CHECKS } = await import("./checks");
    const context = { workspaceId: "space", userId: "me", since: "2026-11-26T09:00:00Z", worker: true };
    expect(checkQuery(TUTORIAL_CHECKS.contactCreated, context).filters).toEqual([
      ["eq", "user_id", "space"],
      ["eq", "created_by", "me"],
      ["gt", "created_at", "2026-11-26T09:00:00Z"],
      ["eq", "is_demo", false],
    ]);
    expect(checkQuery(TUTORIAL_CHECKS.crmTaskDone, context).filters).toContainEqual(["eq", "completed_by", "me"]);
    expect(checkQuery(TUTORIAL_CHECKS.contactMoved, context).filters).toContainEqual(["eq", "actor_id", "me"]);
    expect(checkQuery(TUTORIAL_CHECKS.noteWritten, context).filters).toEqual([
      ["eq", "user_id", "me"],
      ["eq", "space_id", "space"],
      ["gt", "updated_at", "2026-11-26T09:00:00Z"],
      ["is", "deleted_at", null],
    ]);
  });
});
