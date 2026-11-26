import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import cs from "@/locales/cs.json";
import en from "@/locales/en.json";
import { captionKeys, SCENARIOS, SCENARIOS_WITH_GRADY, showcaseSteps } from "./demo-scripts";
import { SCENARIO_IDS } from "./showcase/params";
import { fillValues, SHOWCASE_VALUE_KEYS } from "./showcase/stage-data";
import { estimateScenario } from "./showcase/timing";
import type { ShowcaseStep, ShowcaseTarget } from "./showcase/types";

type Messages = { [key: string]: string | Messages };

function lookup(messages: Messages, key: string): string | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined;
  return typeof node === "string" ? node : undefined;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [readFileSync(full, "utf8")] : [];
  });
}

const CODE = sources(path.resolve(__dirname, "../..")).join("\n");

/** Names made from a template in the code (`task-view-${value}` and the like). */
const TEMPLATES = ["task-view-", "move-table-", "stage-", "nav-", "worker-tab-", "rights-template-", "invite-role-"];

function targetsOf(step: ShowcaseStep): ShowcaseTarget[] {
  if (step.kind === "drag") return [step.target, step.to];
  if (step.kind === "wait") return [step.until, step.gone].filter((t): t is ShowcaseTarget => !!t);
  if (step.kind === "move" || step.kind === "click" || step.kind === "type") return [step.target];
  return [];
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);
}

describe("showcase scenarios", () => {
  it("every scenario exists, with unique step keys", () => {
    for (const id of SCENARIO_IDS) {
      const keys = SCENARIOS[id].steps.map((step) => step.key);
      expect(new Set(keys).size, id).toBe(keys.length);
      expect(keys.length, id).toBeGreaterThan(5);
    }
    expect(showcaseSteps("all")).toHaveLength(
      SCENARIO_IDS.reduce((sum, id) => sum + SCENARIOS[id].steps.length, 0),
    );
  });

  it("each plays 30–60 seconds in both languages", () => {
    for (const id of SCENARIO_IDS) {
      for (const locale of ["cs", "en"] as const) {
        const ms = estimateScenario(SCENARIOS[id].steps, (text) => fillValues(text, locale));
        expect(ms, `${id} ${locale}`).toBeGreaterThanOrEqual(30_000);
        expect(ms, `${id} ${locale}`).toBeLessThanOrEqual(60_000);
      }
    }
  });

  it("every caption has a text in both languages, at most eight words, and the scenario ends without one", () => {
    for (const id of SCENARIO_IDS) {
      const keys = captionKeys(id);
      expect(keys.length, id).toBeGreaterThan(1);
      for (const key of keys) {
        for (const [locale, messages] of [["cs", cs], ["en", en]] as const) {
          const text = lookup(messages as Messages, `showcase.captions.${key}`);
          expect(text, `${locale} ${key}`).toBeTruthy();
          expect(text!.split(/\s+/).filter(Boolean).length, `${locale} ${key}: ${text}`).toBeLessThanOrEqual(8);
        }
      }
      const captions = SCENARIOS[id].steps.filter((step) => step.kind === "caption");
      expect(captions.at(-1), id).toMatchObject({ caption: null });
    }
  });

  it("every target is in the code (data-tutorial, data-tour, data-testid or an id)", () => {
    const missing: string[] = [];
    for (const id of SCENARIO_IDS) {
      for (const step of SCENARIOS[id].steps) {
        for (const target of targetsOf(step)) {
          const name = target.name;
          if (/^[#.[]/.test(name)) {
            for (const match of name.matchAll(/data-(tutorial|testid)="([^"]+)"/g)) {
              const value = match[2]!;
              const found =
                CODE.includes(`data-${match[1]}="${value}"`) ||
                TEMPLATES.some((prefix) => value.startsWith(prefix) && CODE.includes(`${prefix}\${`));
              if (!found) missing.push(`${step.key}: ${value}`);
            }
            const idMatch = /^#([\w-]+)/.exec(name);
            const idTemplate = idMatch?.[1]?.replace(/-[^-]+$/, "-");
            if (
              idMatch &&
              !CODE.includes(`"${idMatch[1]}"`) &&
              !(idTemplate && CODE.includes(`\`${idTemplate}\${`))
            ) {
              missing.push(`${step.key}: ${name}`);
            }
            continue;
          }
          const literal =
            CODE.includes(`data-tutorial="${name}"`) ||
            CODE.includes(`data-tour="${name}"`) ||
            // data-tutorial={condition ? "name" : undefined}
            new RegExp(`data-tutorial=\\{[^}]*"${name}"`).test(CODE);
          const template = TEMPLATES.some((prefix) => name.startsWith(prefix));
          if (!literal && !template) missing.push(`${step.key}: ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every {value} of a script is one the stage has", () => {
    const known = new Set<string>(SHOWCASE_VALUE_KEYS);
    for (const id of SCENARIO_IDS) {
      for (const step of SCENARIOS[id].steps) {
        const texts = [
          ...targetsOf(step).flatMap((target) => [target.name, target.text ?? ""]),
          step.kind === "type" ? step.text : "",
        ];
        for (const key of texts.flatMap(placeholders)) expect(known.has(key), `${step.key}: ${key}`).toBe(true);
      }
    }
  });

  it("Grady's button stays on the canvas only where a scenario talks to him", () => {
    for (const id of SCENARIO_IDS) {
      const usesGrady = SCENARIOS[id].steps.some((step) =>
        targetsOf(step).some((target) => target.name === "grady"),
      );
      expect(SCENARIOS_WITH_GRADY.has(id), id).toBe(usesGrady);
    }
  });
});
