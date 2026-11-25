import type { MetricUnit } from "@/lib/analytics/metrics";
import type { ChartData } from "../types";

/**
 * What the data route of an overview widget hands the browser (29.2): plain
 * numbers with translation keys, never formatted text, so one view draws
 * every widget in its sizes. Names of people are the only free text (lists
 * of accounts), the same the Users page shows; never e-mails.
 */

export type WidgetStatus = "good" | "warn" | "bad";

/** A unit of the registry, or money in a currency (never added across currencies). */
export type FigureUnit = MetricUnit | "money";

export type WidgetFigure = {
  key: string;
  /** A translation key from the root of the messages, e.g. `metrics.items.signups.name`. */
  label: string;
  labelValues?: Record<string, string | number>;
  value: number | null;
  unit: FigureUnit;
  /** With unit money. */
  currency?: string;
  /** The period before; undefined when the comparison is off. */
  previous?: number | null;
  lowerIsBetter?: boolean;
  /** Values over the period, oldest first. */
  spark?: (number | null)[];
  status?: WidgetStatus;
};

export type WidgetRow = {
  id: string;
  /** Plain text (a code, a name, a page) … */
  text?: string;
  /** … or a translation key from the root of the messages … */
  label?: string;
  /** … or an item of a breakdown metric, named as the lists name it (a plan, a country). */
  item?: { metric: string; key: string };
  labelValues?: Record<string, string | number>;
  /** A smaller second line: plain text or a translation key. */
  sub?: string;
  subLabel?: string;
  subValues?: Record<string, string | number>;
  value?: number | null;
  unit?: FigureUnit;
  currency?: string;
  /** An ISO moment shown as a date and time instead of a value. */
  at?: string | null;
  href?: string;
  status?: WidgetStatus;
  /** 0–1 of the largest, to draw a bar. */
  ratio?: number;
};

/** One error group of the Errors widget, with what the quick status change needs. */
export type WidgetErrorGroup = {
  fingerprint: string;
  code: string;
  message: string;
  page: string;
  occurrences: number;
  users: number;
  status: "new" | "in_progress" | "resolved" | "ignored";
  returned: boolean;
  lastAt: string;
};

export type AdminWidgetData = {
  figures: WidgetFigure[];
  rows?: WidgetRow[];
  /** The list's heading, a translation key. */
  rowsTitle?: string;
  /** A second list (the detail shows it under the first). */
  more?: WidgetRow[];
  moreTitle?: string;
  chart?: ChartData;
  /** Errors widget: the new groups to triage in the detail. */
  errors?: WidgetErrorGroup[];
  /** Payments of Stripe's test mode: shown as "test data". */
  testData?: boolean;
  /** The period the numbers are for (ISO days), when the widget has one. */
  range?: { from: string; to: string };
};

/** A widget that has nothing to show yet still answers with figures (zeros), never an error. */
export const EMPTY_WIDGET: AdminWidgetData = { figures: [] };
