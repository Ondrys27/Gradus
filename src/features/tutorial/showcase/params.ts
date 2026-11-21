import { locales, type Locale } from "@/i18n/locales";

/**
 * The showcase (step 27.4): the app plays itself for a marketing video. What
 * it plays is given in the address of /app/ukazka:
 *
 *   /app/ukazka?scenar=a&jazyk=en&velikost=1920x1080
 *
 * `scenar` a–f or `vse` (all of them in a row), `jazyk` cs | en, `velikost`
 * one of the canvases a video is cut for. Anything else falls back to the
 * defaults, never to an error.
 */

export const SHOWCASE_PATH = "/app/ukazka";

export const SCENARIO_IDS = ["a", "b", "c", "d", "e", "f"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];
/** One scenario, or all of them in a row. */
export type ScenarioChoice = ScenarioId | "all";

export const SHOWCASE_SIZES = ["1920x1080", "1080x1920", "1080x1080"] as const;
export type ShowcaseSize = (typeof SHOWCASE_SIZES)[number];

export type ShowcaseParams = {
  scenario: ScenarioChoice;
  locale: Locale;
  size: ShowcaseSize;
};

export const DEFAULT_SHOWCASE: ShowcaseParams = { scenario: "f", locale: "cs", size: "1920x1080" };

/** `vse` in the address (Czech, like the rest of it); `all` is accepted too. */
const ALL_WORDS = new Set(["vse", "all"]);

type Search = { get(name: string): string | null };

export function parseShowcaseParams(search: Search): ShowcaseParams {
  const rawScenario = search.get("scenar")?.trim().toLowerCase() ?? "";
  const scenario: ScenarioChoice = ALL_WORDS.has(rawScenario)
    ? "all"
    : (SCENARIO_IDS as readonly string[]).includes(rawScenario)
      ? (rawScenario as ScenarioId)
      : DEFAULT_SHOWCASE.scenario;
  const rawLocale = search.get("jazyk")?.trim().toLowerCase() ?? "";
  const locale = (locales as readonly string[]).includes(rawLocale)
    ? (rawLocale as Locale)
    : DEFAULT_SHOWCASE.locale;
  const rawSize = search.get("velikost")?.trim().toLowerCase() ?? "";
  const size = (SHOWCASE_SIZES as readonly string[]).includes(rawSize)
    ? (rawSize as ShowcaseSize)
    : DEFAULT_SHOWCASE.size;
  return { scenario, locale, size };
}

/** Whether the address named a scenario at all (the start screen then has it picked). */
export function namesScenario(search: Search): boolean {
  return search.get("scenar") !== null;
}

export function showcaseSearch(params: ShowcaseParams): string {
  const query = new URLSearchParams({
    scenar: params.scenario === "all" ? "vse" : params.scenario,
    jazyk: params.locale,
    velikost: params.size,
  });
  return query.toString();
}

export function showcaseHref(params: ShowcaseParams): string {
  return `${SHOWCASE_PATH}?${showcaseSearch(params)}`;
}

export function sizeOf(size: ShowcaseSize): { width: number; height: number } {
  const [width, height] = size.split("x").map(Number) as [number, number];
  return { width, height };
}

/** The scenarios a choice plays, in order. */
export function scenariosOf(choice: ScenarioChoice): ScenarioId[] {
  return choice === "all" ? [...SCENARIO_IDS] : [choice];
}

/** The file name of a recording: `<scenar>-<jazyk>-<velikost>`. */
export function recordingName(params: ShowcaseParams): string {
  return `${params.scenario === "all" ? "vse" : params.scenario}-${params.locale}-${params.size}`;
}
