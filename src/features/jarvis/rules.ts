/**
 * Jarvis's rules set in the administration (app_settings 'jarvis_rules'):
 * which suggestion types and whether questions may come up on their own,
 * the numbers of the timing, and the owner's instructions that go into the
 * system prompt of the chat and the summaries. Pure: what the stored value
 * means, its defaults (today's constants in proactive.ts) and the limits of
 * the form. The database checks the same limits (valid_jarvis_rules); the
 * read with its 30-second cache is in server/rules.ts. People read the rules
 * in docs/jarvis-pravidla.md.
 */
import { z } from "zod";
import {
  DEFAULT_PROACTIVE_RULES,
  MIN_GAP_HOURS,
  PROACTIVE_SUGGESTION_TYPES,
  type ProactiveRules,
  type ProactiveSuggestionType,
} from "./proactive";

/** The longest owner's instructions, in characters. */
export const OWNER_INSTRUCTIONS_MAX = 2_000;

/** What each number may be set to; the database has the same bounds. */
export const JARVIS_RULE_LIMITS = {
  minGapHours: { min: MIN_GAP_HOURS, max: 72 },
  questionsPerWeek: { min: 0, max: 7 },
  suggestionFreshDays: { min: 1, max: 30 },
  pageSettleSeconds: { min: 10, max: 600 },
} as const;

/** The rules in force, defaults filled in. */
export type JarvisRules = ProactiveRules & {
  /** The owner's instructions for the system prompt; "" = none. */
  instructions: string;
  /** Whether the values come from the database or from the defaults. */
  source: "database" | "default";
};

export const DEFAULT_JARVIS_RULES: JarvisRules = {
  ...DEFAULT_PROACTIVE_RULES,
  instructions: "",
  source: "default",
};

const int = (bounds: { min: number; max: number }) =>
  z.number().int().min(bounds.min).max(bounds.max);

const suggestionTypesSchema = z.partialRecord(
  z.enum(PROACTIVE_SUGGESTION_TYPES),
  z.boolean(),
);

/** The stored 'jarvis_rules' value; valid_jarvis_rules() checks the same. */
export const storedJarvisRulesSchema = z
  .object({
    suggestion_types: suggestionTypesSchema,
    questions: z.boolean(),
    min_gap_hours: int(JARVIS_RULE_LIMITS.minGapHours),
    questions_per_week: int(JARVIS_RULE_LIMITS.questionsPerWeek),
    suggestion_fresh_days: int(JARVIS_RULE_LIMITS.suggestionFreshDays),
    page_settle_seconds: int(JARVIS_RULE_LIMITS.pageSettleSeconds),
    instructions: z.string().max(OWNER_INSTRUCTIONS_MAX),
  })
  .strict();
export type StoredJarvisRules = z.infer<typeof storedJarvisRulesSchema>;

/**
 * The rules from the stored value, or today's constants when there is none
 * (or it is unreadable). A type missing from the stored switches (one added
 * after the owner saved) is on, as it would be by default.
 */
export function resolveJarvisRules(stored: unknown): JarvisRules {
  const parsed = storedJarvisRulesSchema.safeParse(stored);
  if (!parsed.success) return DEFAULT_JARVIS_RULES;
  const value = parsed.data;
  return {
    minGapHours: value.min_gap_hours,
    questionsPerWeek: value.questions_per_week,
    suggestionFreshDays: value.suggestion_fresh_days,
    pageSettleMs: value.page_settle_seconds * 1000,
    suggestionTypes: Object.fromEntries(
      PROACTIVE_SUGGESTION_TYPES.map((type) => [type, value.suggestion_types[type] ?? true]),
    ) as Record<ProactiveSuggestionType, boolean>,
    questions: value.questions,
    instructions: value.instructions,
    source: "database",
  };
}

/** The owner's text as it is kept: trimmed, one kind of line ending. */
export function normalizeInstructions(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

// ---------------------------------------------------------------------------
// The administration's form
// ---------------------------------------------------------------------------

const typedInt = (bounds: { min: number; max: number }) =>
  z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const text = String(value).trim();
      if (!/^\d{1,4}$/.test(text)) {
        ctx.addIssue({ code: "custom", message: "integer" });
        return z.NEVER;
      }
      return Number(text);
    })
    .pipe(z.number().int().min(bounds.min).max(bounds.max));

/** The rules as the form sends them. */
export const jarvisRulesFormSchema = z.object({
  suggestionTypes: z.record(z.enum(PROACTIVE_SUGGESTION_TYPES), z.boolean()),
  questions: z.boolean(),
  minGapHours: typedInt(JARVIS_RULE_LIMITS.minGapHours),
  questionsPerWeek: typedInt(JARVIS_RULE_LIMITS.questionsPerWeek),
  suggestionFreshDays: typedInt(JARVIS_RULE_LIMITS.suggestionFreshDays),
  pageSettleSeconds: typedInt(JARVIS_RULE_LIMITS.pageSettleSeconds),
  instructions: z
    .string()
    .transform(normalizeInstructions)
    .pipe(z.string().max(OWNER_INSTRUCTIONS_MAX)),
});
export type JarvisRulesForm = z.input<typeof jarvisRulesFormSchema>;
export type JarvisRulesFormField = keyof JarvisRulesForm;

export function toStoredJarvisRules(form: z.output<typeof jarvisRulesFormSchema>): StoredJarvisRules {
  return {
    suggestion_types: Object.fromEntries(
      PROACTIVE_SUGGESTION_TYPES.map((type) => [type, form.suggestionTypes[type]]),
    ),
    questions: form.questions,
    min_gap_hours: form.minGapHours,
    questions_per_week: form.questionsPerWeek,
    suggestion_fresh_days: form.suggestionFreshDays,
    page_settle_seconds: form.pageSettleSeconds,
    instructions: form.instructions,
  };
}

/** The rules as the form starts with them. */
export function toJarvisRulesForm(rules: JarvisRules): z.output<typeof jarvisRulesFormSchema> {
  return {
    suggestionTypes: { ...rules.suggestionTypes },
    questions: rules.questions,
    minGapHours: rules.minGapHours,
    questionsPerWeek: rules.questionsPerWeek,
    suggestionFreshDays: rules.suggestionFreshDays,
    pageSettleSeconds: Math.round(rules.pageSettleMs / 1000),
    instructions: rules.instructions,
  };
}
