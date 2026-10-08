import { z } from "zod";

/**
 * The only building blocks an event property may be made of: identifiers,
 * enums, numbers and booleans. Every field in the catalog comes from here; the
 * catalog test walks all schemas and refuses anything else, so free text can
 * not slip in by accident.
 *
 * `key()` is for identifiers the code itself defines (an error code, a path
 * key, a badge key); never pass anything a person typed into it.
 */

const SAFE = new WeakSet<z.ZodType>();
const SCRUBBED = new WeakSet<z.ZodType>();

function safe<T extends z.ZodType>(schema: T): T {
  SAFE.add(schema);
  return schema;
}

/** Six or more digits in a row look like a phone, an ID number or an account number. */
const LONG_NUMBER = /\d{6,}/;

/** Strings that may be stored as an error message after scrubbing (see scrub.ts). */
export const SCRUBBED_MAX = 200;
export function isScrubbed(value: string): boolean {
  return value.length <= SCRUBBED_MAX && !/\d{5,}/.test(value) && !value.includes("@");
}

export const field = {
  /** A row id (uuid). */
  id: () => safe(z.uuid()),
  /** One of the listed values. */
  oneOf: <const T extends readonly [string, ...string[]]>(values: T) => safe(z.enum(values)),
  /** An identifier defined in code or by the system: no spaces, no @, no long numbers. */
  key: () =>
    safe(
      z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,47}$/)
        .refine((value) => !LONG_NUMBER.test(value), "long number"),
    ),
  /** An ISO code of exactly `length` capital letters (currency, country). */
  isoCode: (length: 2 | 3) => safe(z.string().regex(new RegExp(`^[A-Z]{${length}}$`))),
  /** A whole number ≥ 0. */
  count: (max = 1_000_000_000) => safe(z.number().int().min(0).max(max)),
  /** Any finite number (an amount, a signed difference). */
  number: () => safe(z.number().finite().min(-1e12).max(1e12)),
  /** A duration in milliseconds, up to a day. */
  ms: () => safe(z.number().int().min(0).max(86_400_000)),
  bool: () => safe(z.boolean()),
  /**
   * An error message already put through scrubMessage(): at most 200
   * characters, no number longer than 4 digits, nothing like an e-mail. Only
   * events listed in SCRUBBED_TEXT_EVENTS may use it.
   */
  scrubbedText: () => {
    const schema = safe(z.string().min(1).refine(isScrubbed, "not scrubbed"));
    SCRUBBED.add(schema);
    return schema;
  },
  optional: <T extends z.ZodType>(inner: T) => {
    if (!SAFE.has(inner)) throw new Error("optional() wraps only catalog fields");
    return safe(inner.optional());
  },
};

export type SafeField = ReturnType<(typeof field)[Exclude<keyof typeof field, "optional">]>;

/** Whether a schema was built by `field` (the catalog test checks every property). */
export function isSafeField(schema: unknown): boolean {
  return typeof schema === "object" && schema !== null && SAFE.has(schema as z.ZodType);
}

/** Whether a field is the scrubbed error text, which only a few events may carry. */
export function isScrubbedTextField(schema: z.ZodType): boolean {
  const inner = schema instanceof z.ZodOptional ? (schema.unwrap() as z.ZodType) : schema;
  return SCRUBBED.has(inner);
}
