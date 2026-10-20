import type { IsoDate } from "@/lib/format";
import type { MetricUnit } from "@/lib/analytics/metrics";
import type { Database } from "@/types/database";

/** What the server hands the administration's components: plain, serialisable data. */

export type TileData = {
  /** Registry key; its name is `metrics.items.<key>.name`. */
  key: string;
  unit: MetricUnit;
  value: number | null;
  /** The previous period; undefined when the comparison is off. */
  previous?: number | null;
  /** Values over the period for the small chart, oldest first. */
  spark?: (number | null)[];
  /** Fewer is better (costs, churn). */
  lowerIsBetter?: boolean;
  /** Not measured yet: the step of the plan that adds it. */
  pending?: string;
};

export type ChartSeries = {
  /** Registry key; also the column of the rows. */
  key: string;
  kind: "line" | "bar" | "area";
  /** A colour token name: violet, teal, gold, green, orange, pink. */
  color: ChartColor;
  /** Drawn against the right axis (another unit). */
  axis?: "left" | "right";
  /** Starts hidden; the legend switches it on. */
  hidden?: boolean;
  dashed?: boolean;
  /** A name other than the metric's: a key under `admin` with ready-made values. */
  label?: { key: string; values?: Record<string, string> };
};

export const CHART_COLORS = ["violet", "teal", "gold", "green", "orange", "pink"] as const;
export type ChartColor = (typeof CHART_COLORS)[number];

export type ChartRow = { x: string } & Record<string, number | string | null>;

export type ChartData = {
  /** For the audit of exports and the file name: identifiers only. */
  id: string;
  /** How the x values read: calendar days, or week numbers after sign-up. */
  xKind: "day" | "week";
  unit: MetricUnit;
  rightUnit?: MetricUnit;
  series: ChartSeries[];
  rows: ChartRow[];
};

export type BreakdownItem = { key: string; value: number | null; previous?: number | null };

export type BreakdownData = {
  key: string;
  unit: MetricUnit;
  items: BreakdownItem[];
};

/** Several values of one registry metric that returns a single row (waitlist, workers…). */
export type FieldsData = {
  key: string;
  fields: { name: string; unit: MetricUnit; value: number | null; previous?: number | null }[];
};

export type FunnelStep = {
  key: string;
  users: number;
  pctOfStart: number;
  pctOfPrevious: number;
  medianHoursFromPrevious: number | null;
  medianHoursFromStart: number | null;
  previousPctOfStart?: number | null;
};

export type CohortRow = { week: IsoDate; size: number; cells: (number | null)[] };

export type HeatmapCell = { weekday: number; hour: number; events: number; users: number };

/** A block that could not load; the page shows a short note instead of failing whole. */
export type Loaded<T> = { ok: true; data: T } | { ok: false };

// --- Feedback (shared with the client, so they stay out of server-only files) ------

export type FeatureRequestStatus = Database["public"]["Enums"]["feature_request_status"];
export const FEATURE_REQUEST_STATUSES: readonly FeatureRequestStatus[] = [
  "new",
  "planned",
  "in_progress",
  "done",
  "declined",
];

export const BUG_REPORT_STATUSES = ["new", "in_progress", "fixed", "cannot_reproduce"] as const;
export type BugReportStatus = (typeof BUG_REPORT_STATUSES)[number];

/** One bug report as the Feedback page lists it (bug_reports via admin_bug_reports). */
export type BugReportRow = {
  id: string;
  /** Null for a report sent signed out. */
  userId: string | null;
  userName: string | null;
  status: BugReportStatus;
  code: string | null;
  description: string | null;
  /** The error's text after scrubbing, and Next.js's digest of a server error. */
  message: string | null;
  digest: string | null;
  page: string;
  browser: string | null;
  device: string | null;
  viewport: string | null;
  version: string | null;
  createdAt: string;
};

export type FeatureRequestRow = {
  id: string;
  userId: string;
  /** Who sent it, as the administration names people (display-name.ts). */
  userName: string;
  title: string;
  description: string | null;
  status: FeatureRequestStatus;
  createdAt: string;
};
