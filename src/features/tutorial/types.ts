import { z } from "zod";

/**
 * The tutorial a user chose and how far they got, as stored in
 * profiles.tutorial (checked by valid_tutorial_state() in the database):
 * none, a quick look (≈2 minutes, only looking) or the full hands-on
 * tutorial on sample data.
 */

export const TUTORIAL_MODES = ["none", "quick", "full"] as const;
export type TutorialMode = (typeof TUTORIAL_MODES)[number];

/** A tutorial that is walked through (not "none"). */
export type RunningMode = Exclude<TutorialMode, "none">;

export const TUTORIAL_OUTCOMES = ["finished", "skipped", "abandoned"] as const;
export type TutorialOutcome = (typeof TUTORIAL_OUTCOMES)[number];

/** What happened to the sample data at the end of the full tutorial. */
export const DEMO_RESOLUTIONS = ["kept", "deleted"] as const;
export type DemoResolution = (typeof DEMO_RESOLUTIONS)[number];

const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T/);

const stateSchema = z.object({
  mode: z.enum(TUTORIAL_MODES),
  step: z
    .string()
    .regex(/^[A-Za-z0-9_]{0,60}$/)
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  started_at: instant.nullable().optional().transform((value) => value ?? null),
  updated_at: instant.nullable().optional().transform((value) => value ?? null),
  finished_at: instant.nullable().optional().transform((value) => value ?? null),
  outcome: z
    .enum(TUTORIAL_OUTCOMES)
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  demo: z
    .enum(DEMO_RESOLUTIONS)
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});

export type TutorialState = z.output<typeof stateSchema>;

/** The stored state, or null when there is none or it is not one (never throws). */
export function parseTutorialState(value: unknown): TutorialState | null {
  const parsed = stateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
