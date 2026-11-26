import type { TutorialSection } from "./steps";
import type { ScenarioChoice, ScenarioId } from "./showcase/params";
import { scenariosOf } from "./showcase/params";
import type {
  ShowcaseAction,
  ShowcaseCue,
  ShowcaseScenario,
  ShowcaseStep,
  ShowcaseTarget,
} from "./showcase/types";

/**
 * The showcase's scenarios (step 27.4), each 30–60 seconds, as data: what
 * the fake cursor does on the real app, step by step, and the caption at the
 * bottom (`showcase.captions.<scenario>.<key>` in en.json / cs.json, at most
 * eight words). Targets are `data-tutorial` / `data-tour` names (or a CSS
 * selector); `{value}` is the stage's value in the scenario's language
 * (stage-data.ts), so the same script plays in Czech and in English.
 *
 *   a  From an idea to the first client: the milestone and its map, contacts
 *      generated, Cold Calling to Meeting booked, a deal, the win.
 *   b  Grady: a question, an answer from the notes, saved to the notes, the
 *      morning summary.
 *   c  Meeting scheduler: the meeting type, its link, the public page, a
 *      booking, the calendar and the contact.
 *   d  The company: a worker invited, their rights, a task, a message.
 *   e  Money: an invoice with a QR code, the month's plan.
 *   f  All of Gradus in 60 seconds: the best of the others.
 */

type Builder = {
  in(section: TutorialSection): Builder;
  caption(key: string | null): Builder;
  move(target: ShowcaseTarget | string): Builder;
  click(target: ShowcaseTarget | string, options?: { optional?: boolean; after?: number }): Builder;
  type(target: ShowcaseTarget | string, text: string, options?: { enter?: boolean; after?: number }): Builder;
  drag(target: ShowcaseTarget | string, to: ShowcaseTarget | string): Builder;
  scroll(target?: ShowcaseTarget | string, by?: number): Builder;
  wait(ms: number): Builder;
  until(target: ShowcaseTarget | string, ms?: number): Builder;
  gone(target: ShowcaseTarget | string): Builder;
  cue(cue: ShowcaseCue): Builder;
};

const asTarget = (target: ShowcaseTarget | string): ShowcaseTarget =>
  typeof target === "string" ? { name: target } : target;

/** Steps with keys made from the scenario and their order (stable while the script does not change). */
function script(id: ScenarioId, write: (b: Builder) => void): ShowcaseScenario {
  const steps: ShowcaseStep[] = [];
  let section: TutorialSection = "dashboard";
  const push = (action: ShowcaseAction, after?: number) => {
    steps.push({ ...action, key: `${id}${steps.length + 1}`, section, ...(after ? { after } : {}) });
  };
  const builder: Builder = {
    in(next) {
      section = next;
      return builder;
    },
    caption(key) {
      push({ kind: "caption", caption: key === null ? null : `${id}.${key}` });
      return builder;
    },
    move(target) {
      push({ kind: "move", target: asTarget(target) });
      return builder;
    },
    click(target, options) {
      push(
        { kind: "click", target: asTarget(target), ...(options?.optional ? { optional: true } : {}) },
        options?.after,
      );
      return builder;
    },
    type(target, text, options) {
      push(
        { kind: "type", target: asTarget(target), text, ...(options?.enter ? { enter: true } : {}) },
        options?.after,
      );
      return builder;
    },
    drag(target, to) {
      push({ kind: "drag", target: asTarget(target), to: asTarget(to) });
      return builder;
    },
    scroll(target, by) {
      push({ kind: "scroll", ...(target ? { target: asTarget(target) } : {}), ...(by ? { by } : {}) });
      return builder;
    },
    wait(ms) {
      push({ kind: "wait", ms });
      return builder;
    },
    until(target, ms) {
      push({ kind: "wait", until: asTarget(target), ...(ms ? { ms } : {}) });
      return builder;
    },
    gone(target) {
      push({ kind: "wait", gone: asTarget(target) });
      return builder;
    },
    cue(cue) {
      push({ kind: "cue", cue });
      return builder;
    },
  };
  write(builder);
  return { id, steps };
}

const MILESTONE = { name: "demo-milestone", text: "{milestone}" };
const CELEBRATION = "celebration-continue";

/** The milestone, a new task and its mind map (a and f). */
function milestoneMap(b: Builder, withTask: boolean) {
  b.in("milestones").click("nav-milestones").click(MILESTONE).until("task-add");
  if (withTask) b.type('[data-tutorial="task-add"] input', "{newTask}", { enter: true, after: 700 });
  b.click("task-view-map").wait(2600);
}

/** A deal dragged to Won and its celebration (a and f). */
function winDeal(b: Builder, title: string) {
  b.in("pipeline")
    .click("nav-pipeline")
    .until({ name: "deal-card", text: title }, 900)
    .drag({ name: "deal-card", text: title }, "stage-won")
    .until(CELEBRATION, 3600)
    .click(CELEBRATION, { after: 500 })
    .click(CELEBRATION, { optional: true })
    .click(CELEBRATION, { optional: true });
}

/** A question to Grady and his answer from the notes (b and f). */
function askGrady(b: Builder) {
  b.in("grady")
    .click("grady")
    .type("grady-input", "{chatPrompt}", { enter: true })
    .until('[data-testid="grady-save-note"]', 3200);
}

const A = script("a", (b) => {
  b.caption("goal");
  milestoneMap(b, true);
  b.caption("contacts")
    .in("contacts")
    .click("nav-contacts")
    .click("contact-generate")
    .type("#generate-industry", "{industry}")
    .type("#generate-location", "{location}")
    .click("generate-submit")
    .until("generate-show", 1200)
    .click("generate-show", { after: 800 })
    .caption("call")
    .in("coldCalling")
    .click("nav-coldCalling")
    .click({ name: "call-contact", text: "{callContact}" }, { after: 900 })
    .click("call-move")
    .click("move-table-meeting_scheduled")
    .click("move-today")
    .click("move-confirm")
    .caption("deal")
    .in("pipeline")
    .click("deal-offer-create")
    .click("deal-create", { after: 1000 })
    .caption("win");
  winDeal(b, "{dealTitle}");
  b.caption(null).wait(800);
});

const B = script("b", (b) => {
  b.caption("notes")
    .in("notes")
    .click("nav-notes")
    .click({ name: "note-item", text: "{note}" }, { after: 2200 })
    .caption("ask");
  askGrady(b);
  b.caption("save")
    .click('[data-testid="grady-save-note"]')
    .click('[data-testid="grady-save-new-note"]')
    .until("grady-saved-open", 800)
    .click("grady-saved-open", { after: 1600 })
    .click("grady-close", { after: 900 })
    .caption("morning")
    .in("dashboard")
    .click("nav-dashboard", { after: 900 })
    .cue("summary")
    .until("summary-thanks", 6500)
    .click("summary-thanks")
    .caption(null)
    .wait(800);
});

const F = script("f", (b) => {
  b.caption("intro").wait(1800).caption("plan");
  milestoneMap(b, false);
  b.caption("win");
  winDeal(b, "{winDeal}");
  b.caption("grady");
  askGrady(b);
  b.click("grady-close")
    .caption("money")
    .in("finance")
    .click("nav-finance")
    .until("plan-grid", 3200)
    .caption("end")
    .click("nav-dashboard", { after: 2400 })
    .caption(null)
    .wait(600);
});

const guest = (name: string): ShowcaseTarget => ({ name, frame: "guest" });

const C = script("c", (b) => {
  b.caption("intro")
    .in("scheduler")
    .click("nav-scheduler")
    .until('[data-testid="event-type-card"]', 1400)
    .caption("link")
    .click('[data-testid="event-type-card"] [data-tutorial="copy-link"]', { after: 1000 })
    .cue("guestOpen")
    .until(guest('[data-testid="booking-day"]'), 900)
    .caption("book")
    .click(guest('[data-testid="booking-day"]'))
    .click(guest('[data-testid="booking-time"]'))
    .type(guest("#booking-name"), "{guestName}")
    .type(guest("#booking-email"), "{guestEmail}")
    .click(guest('[data-testid="booking-submit"]'))
    .until(guest('[data-testid="booking-success"]'), 2400)
    .cue("guestClose")
    .caption("calendar")
    .in("calendar")
    .click("nav-calendar", { after: 2600 })
    .caption("contact")
    .in("contacts")
    .click("nav-contacts")
    .until({ name: "contact-row", text: "{guestName}" })
    .move({ name: "contact-row", text: "{guestName}" })
    .wait(1600)
    .caption(null)
    .wait(600);
});

const D = script("d", (b) => {
  b.caption("intro")
    .in("workers")
    .click("nav-workers")
    .until('[data-testid="company-list"]', 1600)
    .caption("invite")
    .click("worker-invite")
    .click("worker-invite-new")
    .type("#worker-name", "{newWorker}")
    .type("#worker-email", "{workerEmail}")
    .click("invite-next")
    .caption("rights")
    .click('[data-testid="invite-role-sales"]', { after: 1100 })
    .click("worker-submit")
    .until("worker-invite-done", 1800)
    .click("worker-invite-done")
    .caption("task")
    .in("tasks")
    .click("nav-tasks")
    .click("task-new")
    .type("#crm-task-title", "{workerTask}")
    .type("#crm-task-target", "{taskTarget}")
    .click({ name: "task-target-option", text: "{taskTarget}" })
    .click("#crm-task-assignee")
    .click({ name: '[role="option"]', text: "{worker}" })
    .click("task-submit", { after: 1200 })
    .caption("chat")
    .in("messages")
    .click("nav-messages")
    .click({ name: '[data-testid="chat-person"]', text: "{worker}" })
    .type('[data-testid="chat-input"]', "{chatMessage}", { enter: true, after: 1200 })
    .caption(null)
    .wait(300);
});

/** A cell of the month's plan: Marketing in week 4 (every month has one). */
const PLAN_CELL = '[role="gridcell"][aria-label="{planRow}, {planWeek}"]';

const E = script("e", (b) => {
  b.caption("intro")
    .in("pipeline")
    .click("nav-pipeline")
    .click({ name: "deal-card", text: "{invoiceDeal}" })
    .click("deal-create-invoice")
    .until("invoice-issue", 3400)
    .caption("issue")
    .click("invoice-issue")
    .click("confirm-dialog-confirm")
    .gone("confirm-dialog-confirm")
    .wait(3800)
    .caption("plan")
    .in("finance")
    .click("nav-finance")
    .until("plan-grid", 2400)
    .click(PLAN_CELL)
    .type(`${PLAN_CELL} input`, "{planCell}", { enter: true, after: 3400 })
    .caption(null)
    .wait(600);
});

export const SCENARIOS: Record<ScenarioId, ShowcaseScenario> = { a: A, b: B, c: C, d: D, e: E, f: F };

/** Which scenarios need Grady's button on the canvas. */
export const SCENARIOS_WITH_GRADY: ReadonlySet<ScenarioId> = new Set(["b", "f"]);

/** The steps of a choice: one scenario, or all of them in a row. */
export function showcaseSteps(choice: ScenarioChoice): ShowcaseStep[] {
  return scenariosOf(choice).flatMap((id) => SCENARIOS[id].steps);
}

/** Every caption key a scenario shows (each has its text in both languages). */
export function captionKeys(id: ScenarioId): string[] {
  return SCENARIOS[id].steps.flatMap((step) =>
    step.kind === "caption" && step.caption ? [step.caption] : [],
  );
}
