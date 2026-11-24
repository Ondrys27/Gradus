/**
 * The sample inputs of the administration's model comparison (step 28.9):
 * 3–5 anonymised inputs per job in tests/fixtures/ai/<job>.json, made up
 * for the purpose (no real account's data). Most samples are the context
 * and the message as the job builds them; the milestone review and the
 * sales analysis keep their task text in the context, so their samples are
 * the job's own input and the job's builder writes the prompt (the
 * comparison then follows any change of the prompt).
 *
 * Read on the server only (the page passes the list of samples to the
 * dialog; the texts never go to the browser before a run).
 */
import { z } from "zod";
import analysis from "../../../../tests/fixtures/ai/analysis.json";
import briefing from "../../../../tests/fixtures/ai/briefing.json";
import chat from "../../../../tests/fixtures/ai/chat.json";
import classify from "../../../../tests/fixtures/ai/classify.json";
import emailReply from "../../../../tests/fixtures/ai/email_reply.json";
import meetingNotes from "../../../../tests/fixtures/ai/meeting_notes.json";
import milestoneReview from "../../../../tests/fixtures/ai/milestone_review.json";
import noteMapSuggest from "../../../../tests/fixtures/ai/note_map_suggest.json";
import opportunityScan from "../../../../tests/fixtures/ai/opportunity_scan.json";
import periodSummary from "../../../../tests/fixtures/ai/period_summary.json";
import type { GradyFeature } from "../models";

const id = z.string().regex(/^[a-z0-9-]{1,40}$/);
const lang = z.enum(["cs", "en"]);
/** A short name of the sample for the dialog, in its own language (sample data, like the input). */
const label = z.string().min(1).max(80);

const promptSample = z.object({ id, label, lang, context: z.string(), message: z.string().min(1) });
const periodSample = promptSample.extend({ period: z.enum(["week", "month"]) });
const milestoneSample = z.object({
  id,
  label,
  lang,
  milestone: z.object({
    title: z.string().min(1),
    description: z.string().nullable(),
    category: z.string(),
    target_date: z.string().nullable(),
  }),
  today: z.string(),
  locale: z.string(),
});
const surveySample = z.object({
  id,
  label,
  lang,
  locale: z.string(),
  surveys: z
    .array(
      z.object({
        createdAt: z.string(),
        answers: z.record(z.string(), z.unknown()),
        deal: z
          .object({
            title: z.string(),
            value: z.number().nullable(),
            currency: z.string(),
            outcome: z.enum(["won", "lost", "open"]),
            stage: z.string().nullable(),
            lostReason: z.string().nullable(),
          })
          .nullable(),
      }),
    )
    .min(1),
});

const fileOf = <T extends z.ZodTypeAny>(sample: T) =>
  z.object({ samples: z.array(sample).min(3).max(5) });

export type PromptSample = z.infer<typeof promptSample>;
export type PeriodSample = z.infer<typeof periodSample>;
export type MilestoneSample = z.infer<typeof milestoneSample>;
export type SurveySample = z.infer<typeof surveySample>;

/** The samples of every job the comparison offers, checked once when the module loads. */
export const COMPARE_SAMPLES = {
  chat: fileOf(promptSample).parse(chat).samples,
  milestone_review: fileOf(milestoneSample).parse(milestoneReview).samples,
  classify: fileOf(promptSample).parse(classify).samples,
  opportunity_scan: fileOf(promptSample).parse(opportunityScan).samples,
  analysis: fileOf(surveySample).parse(analysis).samples,
  email_reply: fileOf(promptSample).parse(emailReply).samples,
  briefing: fileOf(promptSample).parse(briefing).samples,
  period_summary: fileOf(periodSample).parse(periodSummary).samples,
  note_map_suggest: fileOf(promptSample).parse(noteMapSuggest).samples,
  meeting_notes: fileOf(promptSample).parse(meetingNotes).samples,
} satisfies Partial<Record<GradyFeature, readonly { id: string; label: string; lang: "cs" | "en" }[]>>;

export type CompareFeature = keyof typeof COMPARE_SAMPLES;
export const COMPARE_FEATURES = Object.keys(COMPARE_SAMPLES) as CompareFeature[];

export function isCompareFeature(feature: string): feature is CompareFeature {
  return (COMPARE_FEATURES as string[]).includes(feature);
}

/** One sample of a job, or null. */
export function compareSample(feature: CompareFeature, sampleId: string) {
  const list: readonly { id: string; label: string; lang: "cs" | "en" }[] = COMPARE_SAMPLES[feature];
  return list.find((sample) => sample.id === sampleId) ?? null;
}
