/**
 * Grady's rules set in the administration (app_settings 'jarvis_rules'):
 * which suggestion types and whether questions may come up on their own,
 * the numbers of the timing, and the owner's instructions that go into the
 * system prompt of the chat and the summaries. Pure: what the stored value
 * means, its defaults (today's constants in proactive.ts) and the limits of
 * the form. The database checks the same limits (valid_jarvis_rules); the
 * read with its 30-second cache is in server/rules.ts. People read the rules
 * in docs/grady-pravidla.md.
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
export const GRADY_RULE_LIMITS = {
  minGapHours: { min: MIN_GAP_HOURS, max: 72 },
  questionsPerWeek: { min: 0, max: 7 },
  suggestionFreshDays: { min: 1, max: 30 },
  pageSettleSeconds: { min: 10, max: 600 },
} as const;

/** The rules in force, defaults filled in. */
export type GradyRules = ProactiveRules & {
  /** The owner's instructions for the system prompt; "" = none. */
  instructions: string;
  /** Whether the values come from the database or from the defaults. */
  source: "database" | "default";
};

export const DEFAULT_GRADY_RULES: GradyRules = {
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
export const storedGradyRulesSchema = z
  .object({
    suggestion_types: suggestionTypesSchema,
    questions: z.boolean(),
    min_gap_hours: int(GRADY_RULE_LIMITS.minGapHours),
    questions_per_week: int(GRADY_RULE_LIMITS.questionsPerWeek),
    suggestion_fresh_days: int(GRADY_RULE_LIMITS.suggestionFreshDays),
    page_settle_seconds: int(GRADY_RULE_LIMITS.pageSettleSeconds),
    instructions: z.string().max(OWNER_INSTRUCTIONS_MAX),
  })
  .strict();
export type StoredGradyRules = z.infer<typeof storedGradyRulesSchema>;

/**
 * The rules from the stored value, or today's constants when there is none
 * (or it is unreadable). A type missing from the stored switches (one added
 * after the owner saved) is on, as it would be by default.
 */
export function resolveGradyRules(stored: unknown): GradyRules {
  const parsed = storedGradyRulesSchema.safeParse(stored);
  if (!parsed.success) return DEFAULT_GRADY_RULES;
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
export const gradyRulesFormSchema = z.object({
  suggestionTypes: z.record(z.enum(PROACTIVE_SUGGESTION_TYPES), z.boolean()),
  questions: z.boolean(),
  minGapHours: typedInt(GRADY_RULE_LIMITS.minGapHours),
  questionsPerWeek: typedInt(GRADY_RULE_LIMITS.questionsPerWeek),
  suggestionFreshDays: typedInt(GRADY_RULE_LIMITS.suggestionFreshDays),
  pageSettleSeconds: typedInt(GRADY_RULE_LIMITS.pageSettleSeconds),
  instructions: z
    .string()
    .transform(normalizeInstructions)
    .pipe(z.string().max(OWNER_INSTRUCTIONS_MAX)),
});
export type GradyRulesForm = z.input<typeof gradyRulesFormSchema>;
export type GradyRulesFormField = keyof GradyRulesForm;

export function toStoredGradyRules(form: z.output<typeof gradyRulesFormSchema>): StoredGradyRules {
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
export function toGradyRulesForm(rules: GradyRules): z.output<typeof gradyRulesFormSchema> {
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
