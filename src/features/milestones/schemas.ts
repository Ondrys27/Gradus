import { z } from "zod";

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const TAG_MAX = 30;

/** Translation keys under `milestones.errors`. */
export type MilestoneErrorKey =
  "titleRequired" | "titleTooLong" | "descriptionTooLong" | "tagTooLong";

const title = z.string().trim().min(1, "titleRequired").max(TITLE_MAX, "titleTooLong");
const description = z.string().trim().max(DESCRIPTION_MAX, "descriptionTooLong");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const milestoneSchema = z.object({
  title,
  description,
  category: z.enum(["work", "personal"]),
  tag: z.string().trim().max(TAG_MAX, "tagTooLong"),
  target_date: isoDate.nullable(),
});
export type MilestoneInput = z.infer<typeof milestoneSchema>;

export const taskSchema = z.object({
  title,
  description,
  status: z.enum(["todo", "in_progress", "done"]),
  due_date: isoDate.nullable(),
});
export type TaskInput = z.infer<typeof taskSchema>;

/** First error per field, as a translation key. */
export function fieldErrors(error: z.ZodError): Partial<Record<string, MilestoneErrorKey>> {
  const result: Partial<Record<string, MilestoneErrorKey>> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0]);
    result[field] ??= issue.message as MilestoneErrorKey;
  }
  return result;
}
