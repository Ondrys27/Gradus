"use client";

import type { Locale } from "@/i18n/locales";
import { aimAt, curveBetween, cursorAt, moveDuration, seedOf, typingDelays, type Point } from "./motion";
import { ShowcaseStepFailed, type PlayerControl, type StepRunner } from "./player";
import { fillValues } from "./stage-data";
import { stage } from "./stage-store";
import type { ShowcaseStep, ShowcaseTarget } from "./types";

/**
 * The showcase's hands on the real app (step 27.4): finds a step's target,
 * glides the fake cursor there along a curve, clicks with the events a real
 * click sends (pointer, mouse, focus, click), types character by character,
 * drags (mouse and pointer events along the way, which dnd-kit and the mind
 * map follow) and scrolls. Everything waits through the player's control,
 * so Space holds it mid-move. A celebration that pops up over the page is
 * clicked away first, the way a person would.
 */

/** How long a target may take to appear (a page compiling on the dev server, a slow answer). */
const FIND_TIMEOUT_MS = 25_000;
/** An optional click gives up quickly. */
const OPTIONAL_TIMEOUT_MS = 2_500;
const POLL_MS = 100;
const FRAME_MS = 16;
/** The breath after a click, before the next thing. */
const AFTER_CLICK_MS = 450;
const CELEBRATION_TARGET = "celebration-continue";
export const GUEST_FRAME_ID = "showcase-guest-frame";

type Found = { element: HTMLElement; frame: HTMLIFrameElement | null };

function normalize(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function guestDocument(): { doc: Document; frame: HTMLIFrameElement } | null {
  const frame = document.getElementById(GUEST_FRAME_ID) as HTMLIFrameElement | null;
  const doc = frame?.contentDocument;
  return frame && doc ? { doc, frame } : null;
}

function candidates(root: ParentNode, name: string): HTMLElement[] {
  try {
    if (/^[#.[]/.test(name)) return [...root.querySelectorAll<HTMLElement>(name)];
    const escaped = name.replace(/["\\]/g, "");
    return [
      ...root.querySelectorAll<HTMLElement>(`[data-tutorial="${escaped}"], [data-tour="${escaped}"]`),
    ];
  } catch {
    return [];
  }
}

function isVisible(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return !style || (style.visibility !== "hidden" && style.opacity !== "0");
}

/** The first visible match of a target right now, or null. */
export function findTarget(target: ShowcaseTarget, locale: Locale): Found | null {
  const where = target.frame === "guest" ? guestDocument() : null;
  if (target.frame === "guest" && !where) return null;
  const root: ParentNode = where?.doc ?? document;
  const wanted = target.text ? normalize(fillValues(target.text, locale)) : null;
  for (const element of candidates(root, fillValues(target.name, locale))) {
    if (!isVisible(element)) continue;
    if (wanted && !normalize(element.textContent ?? "").includes(wanted)) continue;
    return { element, frame: where?.frame ?? null };
  }
  return null;
}

/** The element's box in the app's window (inside the guest's window: moved by the frame's place). */
function boxOf(found: Found) {
  const box = found.element.getBoundingClientRect();
  const offset = found.frame?.getBoundingClientRect();
  return {
    left: box.left + (offset?.left ?? 0),
    top: box.top + (offset?.top ?? 0),
    width: box.width,
    height: box.height,
  };
}

/**
 * Whether a person could click it now: its centre is on screen and nothing
 * (a scroll container's edge, another layer) covers it there.
 */
function inView(found: Found): boolean {
  const box = found.element.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const view = found.element.ownerDocument.defaultView ?? window;
  if (y < 4 || y > view.innerHeight - 4 || x < 0 || x > view.innerWidth) return false;
  const hit = found.element.ownerDocument.elementFromPoint(x, y);
  return !!hit && (hit === found.element || found.element.contains(hit) || hit.contains(found.element));
}

async function bringIntoView(found: Found, target: ShowcaseTarget, locale: Locale, control: PlayerControl) {
  if (inView(found)) return found;
  found.element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  await control.sleep(650);
  return findTarget(target, locale) ?? found;
}

async function locate(
  target: ShowcaseTarget,
  locale: Locale,
  control: PlayerControl,
  timeout = FIND_TIMEOUT_MS,
): Promise<Found | null> {
  const until = control.elapsed() + timeout;
  for (;;) {
    const found = findTarget(target, locale);
    if (found) return bringIntoView(found, target, locale, control);
    if (control.elapsed() >= until) return null;
    await control.sleep(POLL_MS);
  }
}

function describe(target: ShowcaseTarget): string {
  return `${target.frame ? `${target.frame}:` : ""}${target.name}${target.text ? ` "${target.text}"` : ""}`;
}

async function glide(to: Point, key: string, control: PlayerControl) {
  const current = stage.get().cursor;
  const from = current.visible ? { x: current.x, y: current.y } : { x: to.x - 160, y: to.y + 120 };
  if (!current.visible) stage.cursor({ ...from, visible: true });
  const duration = moveDuration(from, to);
  const curve = curveBetween(from, to, seedOf(key));
  const start = control.elapsed();
  for (;;) {
    const elapsed = control.elapsed() - start;
    const point = cursorAt(curve, elapsed, duration);
    stage.cursor({ x: point.x, y: point.y });
    if (elapsed >= duration) break;
    await control.sleep(FRAME_MS);
  }
  stage.cursor({ x: to.x, y: to.y });
}

type EventWindow = Window & typeof globalThis;

function viewOf(element: Element): EventWindow {
  return (element.ownerDocument.defaultView ?? window) as EventWindow;
}

/** A point in the app's window, as the coordinates inside the element's own document. */
function local(found: Found, point: Point): Point {
  const offset = found.frame?.getBoundingClientRect();
  return { x: point.x - (offset?.left ?? 0), y: point.y - (offset?.top ?? 0) };
}

function pointerInit(point: Point, buttons: number) {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    screenX: point.x,
    screenY: point.y,
    button: 0,
    buttons,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  };
}

function fire(element: Element, type: string, point: Point, buttons: number) {
  const view = viewOf(element);
  const init = { ...pointerInit(point, buttons), view };
  const event = type.startsWith("pointer")
    ? new view.PointerEvent(type, init)
    : new view.MouseEvent(type, init);
  return element.dispatchEvent(event);
}

function focusable(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>(
    "input, textarea, select, button, a[href], [tabindex], [contenteditable='true']",
  );
}

/** What a click opens: a same-site page in a new tab goes into the guest's window instead. */
function guestLink(element: HTMLElement): string | null {
  const link = element.closest<HTMLAnchorElement>("a[target='_blank'][href]");
  if (!link) return null;
  try {
    const url = new URL(link.href, window.location.href);
    return url.origin === window.location.origin ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}

async function clearCelebrations(target: ShowcaseTarget, locale: Locale, control: PlayerControl) {
  if (target.name === CELEBRATION_TARGET) return;
  for (let round = 0; round < 4; round += 1) {
    const found = findTarget({ name: CELEBRATION_TARGET }, locale);
    if (!found) return;
    // Let the moment be seen before it is clicked away.
    await control.sleep(1600);
    await clickFound(found, `celebration-${round}`, control);
    await control.sleep(700);
  }
}

async function clickFound(found: Found, key: string, control: PlayerControl) {
  const aim = aimAt(boxOf(found), seedOf(key));
  await glide(aim, key, control);
  const point = local(found, aim);
  // What a real click hits: the innermost element under the point, inside the target
  // (a wrapper's button, a card's link).
  const hit = found.element.ownerDocument.elementFromPoint(point.x, point.y);
  const element: Element = hit && found.element.contains(hit) ? hit : found.element;
  stage.cursor({ pressed: true });
  stage.clicked(aim.x, aim.y);
  fire(element, "pointerover", point, 0);
  fire(element, "mouseover", point, 0);
  fire(element, "pointerdown", point, 1);
  fire(element, "mousedown", point, 1);
  (element instanceof HTMLElement ? focusable(element) : focusable(found.element))?.focus({
    preventScroll: true,
  });
  await control.sleep(90);
  fire(element, "pointerup", point, 0);
  fire(element, "mouseup", point, 0);
  stage.cursor({ pressed: false });
  const guest = guestLink(found.element);
  if (guest) {
    stage.set({ guestUrl: guest });
  } else {
    // A dispatched click does what a real one does: React's handlers, a link's navigation.
    fire(element, "click", point, 0);
  }
  await control.sleep(AFTER_CLICK_MS);
}

function insertText(element: HTMLElement, text: string) {
  const doc = element.ownerDocument;
  if (doc.activeElement !== element && !element.contains(doc.activeElement)) {
    element.focus({ preventScroll: true });
  }
  // execCommand types like a keyboard: React, the editor and undo all see a real input.
  if (doc.execCommand("insertText", false, text)) return;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const proto = Object.getPrototypeOf(element) as object;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(element, element.value + text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function selectAll(element: HTMLElement) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.select();
    return element.value.length > 0;
  }
  return false;
}

function pressEnter(element: HTMLElement) {
  const view = viewOf(element);
  const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
  const proceed = element.dispatchEvent(new view.KeyboardEvent("keydown", init));
  element.dispatchEvent(new view.KeyboardEvent("keyup", init));
  // A browser submits a form on Enter in its field; a dispatched key does not, so it is done here.
  if (proceed && element instanceof HTMLInputElement && element.form) element.form.requestSubmit();
}

/** The field to type into: the target itself or the first field inside it. */
function fieldOf(element: HTMLElement): HTMLElement {
  if (element.matches("input, textarea, [contenteditable='true']")) return element;
  return (
    element.querySelector<HTMLElement>("input, textarea, [contenteditable='true']") ?? element
  );
}

async function drag(from: Found, to: Found, key: string, control: PlayerControl) {
  const start = aimAt(boxOf(from), seedOf(key));
  await glide(start, key, control);
  const element = from.element;
  stage.cursor({ pressed: true });
  fire(element, "pointerdown", local(from, start), 1);
  fire(element, "mousedown", local(from, start), 1);
  await control.sleep(160);
  const end = aimAt(boxOf(to), seedOf(`${key}:to`));
  const curve = curveBetween(start, end, seedOf(`${key}:path`));
  const duration = Math.max(900, moveDuration(start, end) * 1.4);
  const began = control.elapsed();
  let last = start;
  for (;;) {
    const elapsed = control.elapsed() - began;
    const point = cursorAt(curve, elapsed, duration);
    stage.cursor({ x: point.x, y: point.y });
    const under = document.elementFromPoint(point.x, point.y) ?? document.body;
    fire(under, "pointermove", point, 1);
    fire(under, "mousemove", point, 1);
    last = point;
    if (elapsed >= duration) break;
    await control.sleep(FRAME_MS);
  }
  // A moment over the target, as a hand slows down before letting go.
  await control.sleep(220);
  const under = document.elementFromPoint(last.x, last.y) ?? document.body;
  fire(under, "pointermove", last, 1);
  fire(under, "mousemove", last, 1);
  await control.sleep(60);
  fire(under, "pointerup", last, 0);
  fire(under, "mouseup", last, 0);
  stage.cursor({ pressed: false });
  await control.sleep(AFTER_CLICK_MS);
}

async function waitFor(
  target: ShowcaseTarget,
  gone: boolean,
  locale: Locale,
  control: PlayerControl,
  timeout = FIND_TIMEOUT_MS,
): Promise<boolean> {
  const until = control.elapsed() + timeout;
  for (;;) {
    const present = findTarget(target, locale) !== null;
    if (present !== gone) return true;
    if (control.elapsed() >= until) return false;
    await control.sleep(POLL_MS);
  }
}

/** The runner the player calls for every step that is not a caption or a plain pause. */
export function createDomRunner(
  locale: Locale,
  /** The public booking page the guest's window opens (scenario c). */
  options: { guestPath?: string } = {},
): StepRunner {
  return async function run(step: ShowcaseStep, control: PlayerControl) {
    switch (step.kind) {
      case "move": {
        await clearCelebrations(step.target, locale, control);
        const found = await locate(step.target, locale, control);
        if (!found) throw new ShowcaseStepFailed(`not found: ${describe(step.target)}`);
        await glide(aimAt(boxOf(found), seedOf(step.key)), step.key, control);
        await control.sleep(250);
        return;
      }
      case "click": {
        await clearCelebrations(step.target, locale, control);
        const found = await locate(
          step.target,
          locale,
          control,
          step.optional ? OPTIONAL_TIMEOUT_MS : FIND_TIMEOUT_MS,
        );
        if (!found) {
          if (step.optional) return;
          throw new ShowcaseStepFailed(`not found: ${describe(step.target)}`);
        }
        await clickFound(found, step.key, control);
        return;
      }
      case "type": {
        await clearCelebrations(step.target, locale, control);
        const found = await locate(step.target, locale, control);
        if (!found) throw new ShowcaseStepFailed(`not found: ${describe(step.target)}`);
        const field = fieldOf(found.element);
        await clickFound({ element: field, frame: found.frame }, step.key, control);
        if (selectAll(field)) await control.sleep(120);
        const text = fillValues(step.text, locale);
        const delays = typingDelays(text, seedOf(step.key));
        for (const [index, char] of [...text].entries()) {
          await control.sleep(delays[index] ?? 80);
          insertText(field, char);
        }
        if (step.enter) {
          await control.sleep(320);
          pressEnter(field);
        }
        await control.sleep(300);
        return;
      }
      case "drag": {
        await clearCelebrations(step.target, locale, control);
        // Where it goes first, to the middle of its scroll area (a board scrolls by itself
        // while something is carried near its edge), then what is carried.
        const to = await locate(step.to, locale, control);
        if (!to) throw new ShowcaseStepFailed(`not found: ${describe(step.to)}`);
        to.element.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
        await control.sleep(700);
        const from = await locate(step.target, locale, control);
        if (!from) throw new ShowcaseStepFailed(`not found: ${describe(step.target)}`);
        await drag(from, findTarget(step.to, locale) ?? to, step.key, control);
        return;
      }
      case "scroll": {
        if (step.target) {
          const found = findTarget(step.target, locale);
          found?.element.scrollIntoView({ block: "center", behavior: "smooth" });
        } else {
          window.scrollBy({ top: step.by ?? 400, behavior: "smooth" });
        }
        await control.sleep(800);
        return;
      }
      case "wait": {
        if (step.until && !(await waitFor(step.until, false, locale, control))) {
          throw new ShowcaseStepFailed(`never appeared: ${describe(step.until)}`);
        }
        if (step.gone && !(await waitFor(step.gone, true, locale, control))) {
          throw new ShowcaseStepFailed(`never went: ${describe(step.gone)}`);
        }
        if (step.ms) await control.sleep(step.ms);
        return;
      }
      case "cue": {
        if (step.cue === "summary") stage.set({ summary: "show" });
        if (step.cue === "guestOpen" && options.guestPath) stage.set({ guestUrl: options.guestPath });
        if (step.cue === "guestClose") stage.set({ guestUrl: null });
        await control.sleep(300);
        return;
      }
      case "caption":
        return;
    }
  };
}
