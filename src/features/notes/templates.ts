/**
 * Prepared notes offered while the list is empty: a title and a short outline
 * of questions to answer. The words live in en.json / cs.json under
 * `notes.templates.<key>`; this file decides which questions a template has,
 * including one more for the industry picked in onboarding where it helps.
 * The keys are stable: milestone templates refer to them (note_template).
 */
import type { IndustryKey } from "@/features/onboarding/industries";
import { draftFromDoc, type DocNode, type NoteDraft } from "./document";

export const NOTE_TEMPLATE_KEYS = [
  "idealCustomer",
  "offer",
  "pricing",
  "competition",
  "salesScript",
] as const;
export type NoteTemplateKey = (typeof NOTE_TEMPLATE_KEYS)[number];

export const TEMPLATE_QUESTIONS = {
  idealCustomer: ["who", "problem", "today", "where", "decides"],
  offer: ["what", "outcome", "different", "main", "later"],
  pricing: ["items", "basis", "margin", "discounts", "compare"],
  competition: ["who", "strong", "weak", "prices", "edge"],
  salesScript: ["opening", "questions", "pitch", "objections", "close"],
} as const satisfies Record<NoteTemplateKey, readonly string[]>;

/**
 * Templates that get one extra question for an industry, stored as
 * `notes.templates.<key>.industry.<industry>`. "other" gets none.
 */
export const INDUSTRY_TEMPLATES: readonly NoteTemplateKey[] = ["idealCustomer", "pricing"];

export function hasIndustryQuestion(key: NoteTemplateKey, industry: IndustryKey | null): boolean {
  return !!industry && industry !== "other" && INDUSTRY_TEMPLATES.includes(key);
}

/** Translates a key under `notes.templates`. */
export type TemplateTranslator = (key: string) => string;

function text(value: string): DocNode[] {
  return value ? [{ type: "text", text: value }] : [];
}

/**
 * The document of a prepared note: its title as the first line, a one-line
 * hint, then each question as a small heading with an empty line to answer.
 */
export function templateDoc(
  key: NoteTemplateKey,
  industry: IndustryKey | null,
  t: TemplateTranslator,
): DocNode {
  const questions: string[] = TEMPLATE_QUESTIONS[key].map((q) => t(`${key}.questions.${q}`));
  if (hasIndustryQuestion(key, industry)) questions.splice(1, 0, t(`${key}.industry.${industry}`));
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: text(t(`${key}.title`)) },
      { type: "paragraph", content: text(t(`${key}.hint`)) },
      ...questions.flatMap<DocNode>((question) => [
        { type: "heading", attrs: { level: 3 }, content: text(question) },
        { type: "paragraph" },
      ]),
    ],
  };
}

export function templateDraft(
  key: NoteTemplateKey,
  industry: IndustryKey | null,
  t: TemplateTranslator,
): NoteDraft {
  return draftFromDoc(templateDoc(key, industry, t));
}
