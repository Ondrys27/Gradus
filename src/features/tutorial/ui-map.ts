import { GROUP_A_ELEMENTS, GROUP_A_GUIDES } from "./ui-map/group-a";
import { GROUP_B_ELEMENTS, GROUP_B_GUIDES } from "./ui-map/group-b";
import { GROUP_C_ELEMENTS, GROUP_C_GUIDES } from "./ui-map/group-c";
import { GROUP_D_ELEMENTS, GROUP_D_GUIDES } from "./ui-map/group-d";
import type { GuideSection, SectionGuideDef, UiElement } from "./ui-map/types";

/**
 * The catalog of controls (30.8): every element a guide points at, with its
 * `data-tutorial` key, its section and page, what to open first to reach it
 * and the right it needs; its name, purpose and the words people ask with
 * are in the translations (`tutorial.ui.<key>`). Section guides are built
 * from it, Grady's own guide may answer only with its keys, and a test keeps
 * it and the app's `data-tutorial` attributes the same both ways.
 *
 * Kept in four files by area: group-a (dashboard, milestones, notes, sales
 * tasks), group-b (contacts, Cold Calling, pipeline, calendar, scheduler),
 * group-c (finance, invoices, company, rewards, messages), group-d (Grady,
 * settings, connected apps, the administration, shared dialogs).
 */

export type { GuideSection, SectionGuideDef, UiElement } from "./ui-map/types";

export const UI_MAP: readonly UiElement[] = [
  ...GROUP_A_ELEMENTS,
  ...GROUP_B_ELEMENTS,
  ...GROUP_C_ELEMENTS,
  ...GROUP_D_ELEMENTS,
];

export const UI_MAP_BY_KEY: ReadonlyMap<string, UiElement> = new Map(
  UI_MAP.map((element) => [element.key, element]),
);

export const SECTION_GUIDES: readonly SectionGuideDef[] = [
  ...GROUP_A_GUIDES,
  ...GROUP_B_GUIDES,
  ...GROUP_C_GUIDES,
  ...GROUP_D_GUIDES,
];

/**
 * `data-tutorial` keys of the app that are no guide's target: the tutorial's
 * and the showcase's own marks outside any section. The test that keeps the
 * catalog and the app the same knows them by name.
 */
export const UI_MAP_EXEMPT: Readonly<Record<string, string>> = {
  "celebration-continue": "the button of a celebration, over any page",
  "summary-thanks": "Grady's day summary, never opened on request",
  "demo-milestone": "the tutorial's sample milestone (others are milestone-card)",
  "meeting-submit": "the public booking page, outside the app",
  "confirm-dialog-confirm": "the shared confirmation; the step before names what it confirms",
};

const GUIDE_BY_SECTION = new Map(SECTION_GUIDES.map((guide) => [guide.section, guide]));

export function sectionGuide(section: GuideSection): SectionGuideDef | null {
  return GUIDE_BY_SECTION.get(section) ?? null;
}

export function uiElement(key: string): UiElement | null {
  return UI_MAP_BY_KEY.get(key) ?? null;
}

/** FNV-1a, base 36: the same in the browser and on the server. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * The version of the catalog, part of the key of every cached answer: a
 * moved element, a new one or a changed path makes the old answers stale.
 */
export const UI_MAP_VERSION = `m${fingerprint(
  JSON.stringify(UI_MAP.map((element) => [element.key, element.section, element.path, element.via ?? []])),
)}`;
