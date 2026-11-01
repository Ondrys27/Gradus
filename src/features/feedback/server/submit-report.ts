import { reportSchema, prepareReport, type PreparedReport } from "../report";

export type SubmitDeps = {
  /** The signed-in user of the request; the dialog exists only in the app. */
  userId: string | null;
  /** Stores the report through bug_report_create; null = the hourly limit is reached. */
  store: (report: PreparedReport, userId: string) => Promise<string | null>;
  /** Uploads the screenshot and records its path; true when it was kept. */
  attachScreenshot: (reportId: string, userId: string, image: Buffer) => Promise<boolean>;
  /** Analytics and the owner's e-mail, once the report is stored. */
  afterStored: (report: PreparedReport, reportId: string, screenshotKept: boolean) => void;
};

export type SubmitResult = {
  status: 200 | 400 | 401 | 429;
  body: { ok: true; screenshot: boolean } | { error: "invalid" | "unauthorized" | "limited" };
};

/** The work of POST /api/report-problem. */
export async function submitReport(payload: unknown, deps: SubmitDeps): Promise<SubmitResult> {
  if (!deps.userId) return { status: 401, body: { error: "unauthorized" } };
  const parsed = reportSchema.safeParse(payload);
  if (!parsed.success) return { status: 400, body: { error: "invalid" } };
  const report = prepareReport(parsed.data);
  if (report.screenshotRejected) return { status: 400, body: { error: "invalid" } };
  const reportId = await deps.store(report, deps.userId);
  if (!reportId) return { status: 429, body: { error: "limited" } };
  let kept = false;
  if (report.screenshot) {
    // The report is worth more than the picture: a failed upload keeps the report.
    kept = await deps.attachScreenshot(reportId, deps.userId, report.screenshot).catch(() => false);
  }
  deps.afterStored(report, reportId, kept);
  return { status: 200, body: { ok: true, screenshot: kept } };
}
