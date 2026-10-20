import { bugReportSchema, prepareBugReport, type PreparedBugReport } from "../report";

export type SubmitOutcome = "created" | "duplicate" | "limited";

export type SubmitDeps = {
  /** The signed-in user of the request, or null (the error page works signed out). */
  userId: string | null;
  /** Stores the report through bug_report_submit (limits, one per code). */
  store: (report: PreparedBugReport, userId: string | null) => Promise<SubmitOutcome>;
  /** Records bug_report_sent once a report was really stored. */
  record: (report: PreparedBugReport) => Promise<void>;
};

export type SubmitResult = {
  status: 200 | 400 | 429;
  body: { ok: true } | { error: "invalid" | "limited" };
};

/**
 * The work of POST /api/bug-report. A second report with the same code is
 * answered like the first (the person sees the thanks either way) but writes
 * nothing; too many reports get 429.
 */
export async function submitBugReport(payload: unknown, deps: SubmitDeps): Promise<SubmitResult> {
  const parsed = bugReportSchema.safeParse(payload);
  if (!parsed.success) return { status: 400, body: { error: "invalid" } };
  const report = prepareBugReport(parsed.data);
  const outcome = await deps.store(report, deps.userId);
  if (outcome === "limited") return { status: 429, body: { error: "limited" } };
  if (outcome === "created") await deps.record(report);
  return { status: 200, body: { ok: true } };
}
