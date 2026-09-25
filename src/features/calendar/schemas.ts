import { z } from "zod";
import { EVENT_KINDS } from "./types";

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;

/** Translation keys under `calendar.errors`. */
export type CalendarErrorKey =
  | "titleRequired"
  | "titleTooLong"
  | "startRequired"
  | "endRequired"
  | "endBeforeStart"
  | "descriptionTooLong";

export const eventSchema = z
  .object({
    title: z.string().trim().min(1, "titleRequired").max(TITLE_MAX, "titleTooLong"),
    kind: z.enum(EVENT_KINDS),
    starts_at: z.string().min(1, "startRequired"),
    ends_at: z.string().nullable(),
    all_day: z.boolean(),
    description: z.string().trim().max(DESCRIPTION_MAX, "descriptionTooLong"),
    contact_id: z.string().uuid().nullable(),
    deal_id: z.string().uuid().nullable(),
  })
  .superRefine((event, context) => {
    if (event.all_day) {
      if (event.ends_at && event.ends_at < event.starts_at) {
        context.addIssue({ code: "custom", path: ["ends_at"], message: "endBeforeStart" });
      }
      return;
    }
    if (!event.ends_at) {
      context.addIssue({ code: "custom", path: ["ends_at"], message: "endRequired" });
    } else if (event.ends_at <= event.starts_at) {
      context.addIssue({ code: "custom", path: ["ends_at"], message: "endBeforeStart" });
    }
  });
export type EventInput = z.infer<typeof eventSchema>;
