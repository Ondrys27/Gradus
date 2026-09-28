import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cleanAnswers } from "../../dashboard/survey-questions";
import { SALES_ANALYSIS_MIN_SURVEYS } from "../protocol";
import { streamModel, type ModelCall, type ModelClient } from "./model";

type Client = SupabaseClient<Database>;

/** The newest surveys the analysis reads; enough for patterns, bounded in tokens. */
const SURVEY_LIMIT = 150;

export type SurveyForAnalysis = {
  createdAt: string;
  answers: Record<string, unknown>;
  deal: {
    title: string;
    value: number | null;
    currency: string;
    outcome: "won" | "lost" | "open";
    stage: string | null;
    lostReason: string | null;
  } | null;
};

function outcomeOf(deal: {
  won_at: string | null;
  lost_at: string | null;
}): "won" | "lost" | "open" {
  if (deal.won_at) return "won";
  if (deal.lost_at) return "lost";
  return "open";
}

/** Surveys with the result of their deal, read with the user's own client (RLS). */
export async function loadSurveysForAnalysis(supabase: Client): Promise<SurveyForAnalysis[]> {
  const { data, error } = await supabase
    .from("meeting_surveys")
    .select(
      "created_at, answers, deal:deals(title, value, currency, won_at, lost_at, lost_reason, stage:pipeline_stages(name))",
    )
    .order("created_at", { ascending: false })
    .limit(SURVEY_LIMIT);
  if (error) throw error;
  return data.map((row) => ({
    createdAt: row.created_at,
    answers: cleanAnswers(row.answers),
    deal: row.deal
      ? {
          title: row.deal.title,
          value: row.deal.value === null ? null : Number(row.deal.value),
          currency: row.deal.currency,
          outcome: outcomeOf(row.deal),
          stage: row.deal.stage?.name ?? null,
          lostReason: row.deal.lost_reason,
        }
      : null,
  }));
}

export function salesAnalysisContext(surveys: SurveyForAnalysis[], locale: string): string {
  const counts = { won: 0, lost: 0, open: 0 };
  for (const survey of surveys) if (survey.deal) counts[survey.deal.outcome] += 1;
  const lines = surveys.map((survey, index) => {
    const deal = survey.deal
      ? `deal "${survey.deal.title}", outcome: ${survey.deal.outcome}` +
        (survey.deal.stage && survey.deal.outcome === "open"
          ? ` (stage "${survey.deal.stage}")`
          : "") +
        (survey.deal.value !== null ? `, value ${survey.deal.value} ${survey.deal.currency}` : "") +
        (survey.deal.lostReason ? `, lost reason "${survey.deal.lostReason}"` : "")
      : "deal deleted";
    return `${index + 1}. ${survey.createdAt.slice(0, 10)}, ${deal}\n   answers: ${JSON.stringify(survey.answers)}`;
  });
  return `<task>
Analyse the user's sales meetings. Below are their meeting surveys (filled in right after a first meeting) with the result of each deal.
Answers are stored as codes: duration, format, attendees, mood / interest / confidence on a 1–5 scale, objections, whatWorked, whatDidntWork (free text), decisionProcess, nextStep, notes (free text). Read the codes as the English words they are.

Look for patterns that separate won deals from lost ones. Write three short sections, each starting with its own line as a label:
1. What works (backed by the data, e.g. "4 of 5 won deals had the decision maker present").
2. What does not work.
3. Recommendations: three to five concrete things to do differently in the next meetings.
Use numbers from the data. If the sample is too small or mixed to be sure about something, say so instead of guessing. If things go well, say so and do not invent problems.
Plain text, simple "- " lists are fine, no tables, no bold markers. Write in the interface language (${locale}).
</task>
<surveys total="${surveys.length}" won="${counts.won}" lost="${counts.lost}" open="${counts.open}">
${lines.join("\n")}
</surveys>`;
}

export const MAX_ANALYSIS_LENGTH = 20_000;

/**
 * Opus writes the analysis once the user has filled in enough surveys; it is
 * saved to sales_analyses (server-only) with the session's user id.
 */
export async function runSalesAnalysis(args: {
  client: ModelClient;
  supabase: Client;
  admin: Client;
  userId: string;
  locale: string;
  log: ModelCall["log"];
}) {
  const surveys = await loadSurveysForAnalysis(args.supabase);
  if (surveys.length < SALES_ANALYSIS_MIN_SURVEYS)
    return { ok: false as const, code: "locked" as const };

  const result = await streamModel({
    client: args.client,
    feature: "analysis",
    context: salesAnalysisContext(surveys, args.locale),
    messages: [{ role: "user", content: "Analyse my sales meetings." }],
    log: args.log,
  });
  if (!result.ok) return { ok: false as const, code: result.code };

  const content = result.text.trim().slice(0, MAX_ANALYSIS_LENGTH);
  const { data, error } = await args.admin
    .from("sales_analyses")
    .insert({ user_id: args.userId, content })
    .select("id, content, created_at")
    .single();
  if (error) throw error;
  return { ok: true as const, analysis: data };
}
