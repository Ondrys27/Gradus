import { addDays } from "date-fns";
import {
  type FormatSettings,
  isoDateToLocal,
  localToIsoDate,
  todayIsoDate,
  zonedWallClockToInstant,
} from "@/lib/format";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days of use before the first question. */
export const SURVEY_FIRST_AFTER_DAYS = 14;
/** Days after an answer, or after three closes in a row, before asking again. */
export const SURVEY_INTERVAL_DAYS = 30;
/** Closes in a row that pause the survey for SURVEY_INTERVAL_DAYS. */
export const SURVEY_CLOSES_BEFORE_PAUSE = 3;

/**
 * Whether the dashboard should show the satisfaction survey: the account is at
 * least 14 days old, the last answer is at least 30 days back, and no close
 * is still pausing it.
 */
export function surveyDue({
  createdAt,
  lastAnswerAt,
  snoozedUntil,
  now = new Date(),
}: {
  createdAt: string;
  lastAnswerAt: string | null;
  snoozedUntil: string | null;
  now?: Date;
}): boolean {
  const signedUp = new Date(createdAt).getTime();
  if (!Number.isFinite(signedUp)) return false;
  if (now.getTime() - signedUp < SURVEY_FIRST_AFTER_DAYS * DAY_MS) return false;
  if (lastAnswerAt && now.getTime() - new Date(lastAnswerAt).getTime() < SURVEY_INTERVAL_DAYS * DAY_MS) {
    return false;
  }
  if (snoozedUntil && now.getTime() < new Date(snoozedUntil).getTime()) return false;
  return true;
}

/**
 * What a close does: until the next midnight in the user's zone, or, on the
 * third close in a row, for 30 days with the count starting again.
 */
export function closeSurvey({
  streak,
  settings,
  now = new Date(),
}: {
  streak: number;
  settings: FormatSettings;
  now?: Date;
}): { snoozedUntil: string; streak: number; paused: boolean } {
  const next = streak + 1;
  if (next >= SURVEY_CLOSES_BEFORE_PAUSE) {
    return {
      snoozedUntil: new Date(now.getTime() + SURVEY_INTERVAL_DAYS * DAY_MS).toISOString(),
      streak: 0,
      paused: true,
    };
  }
  const tomorrow = localToIsoDate(addDays(isoDateToLocal(todayIsoDate(settings, now)), 1));
  return {
    snoozedUntil: zonedWallClockToInstant(tomorrow, "00:00", settings.timeZone).toISOString(),
    streak: next,
    paused: false,
  };
}
