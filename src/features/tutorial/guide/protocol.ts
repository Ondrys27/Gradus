import { z } from "zod";
import type { ChatErrorCode } from "@/features/grady/protocol";
import { GUIDE_SECTIONS } from "../ui-map/types";
import type { GuidePlan } from "./plan";
import { QUESTION_MAX } from "./question";

/**
 * Grady's own guide over the wire (30.8): `POST /api/grady` with
 * `kind: "guideAnswer"`, the question and the section the person is in (the
 * server checks it against what they have; the rights are read there, never
 * taken from the browser). The answer is the checked plan, or why there is none.
 */

export const GUIDE_QUESTION_MIN = 3;

export const guideAnswerRequestSchema = z.object({
  kind: z.literal("guideAnswer"),
  question: z.string().trim().min(GUIDE_QUESTION_MIN).max(QUESTION_MAX),
  section: z.enum(GUIDE_SECTIONS as unknown as [string, ...string[]]).nullable(),
  /** Where the question came from, for the analytics only. */
  from: z.enum(["menu", "bubble", "search", "chat", "after"]).default("menu"),
});
export type GuideAnswerRequest = z.input<typeof guideAnswerRequestSchema>;

export type GuideAnswerResponse =
  | { ok: true; plan: GuidePlan; cached: boolean }
  | { ok: false; code: ChatErrorCode };
