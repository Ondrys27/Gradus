import "server-only";
import { stripeModeOfKey } from "@/features/billing/stripe/modes";
import { exchangeRateHealth } from "@/features/currency/server/rates";
import { METRICS_TIMEZONE, shiftDay } from "@/lib/analytics/metrics";
import type { EventName } from "@/lib/analytics/events";
import { APP_VERSION } from "@/lib/app-version";
import { createAdminClient } from "@/lib/supabase/admin";
import { envHealth } from "../../env-health";
import { isErrorGroupStatus } from "../../error-log";
import { adminCan } from "../../roles";
import type { AdminContext } from "../../server/guard";
import { loadAiCapsOverview, loadPeriodSpend } from "../../server/ai-caps-data";
import { loadModelsOverview } from "../../server/ai-models-data";
import { loadAuditPage } from "../../server/audit-data";
import { autoTile } from "../../server/auto-metrics";
import { loadErrorGroups } from "../../server/error-log-data";
import {
  countNewBugReports,
  featureRequestCounts,
  loadBugReports,
  loadSatisfactionSummary,
} from "../../server/feedback-data";
import {
  breakdown,
  dailyChart,
  distribution,
  scalarTile,
  seriesTile,
  type AdminQuery,
} from "../../server/metrics-data";
import {
  activationFunnel,
  aiByFeature,
  aiByModel,
  aiTopUsers,
  costBreakdownFields,
  cronRuns,
  featureAdoption,
  healthChart,
  marginByPlanRows,
  mrrByCurrency,
  overviewChart,
  pageLoad,
  paymentsByCurrency,
  routeLatency,
  trialFields,
  type PaymentsRow,
} from "../../server/page-data";
import { loadCatalogVersions } from "../../server/plans-data";
import { loadPromoCodes } from "../../server/promo-data";
import { peopleNamer } from "../../server/people";
import { loadUsers } from "../../server/users-data";
import type { BreakdownData, TileData } from "../../types";
import type { AdminWidgetKey } from "../catalog";
import type {
  AdminWidgetData,
  WidgetErrorGroup,
  WidgetFigure,
  WidgetRow,
  WidgetStatus,
} from "../data";

/**
 * The data of every widget of the overview (29.2), only from what the
 * sections of the administration already read (the metric registry, the
 * error log, the feedback, the AI caps and models, the promo codes, the
 * audit): nothing is counted a second way. Server code after the admin guard
 * and the widget's power were checked (the route); the admin client reads
 * every account, the widgets get counts and, for lists of accounts, names.
 */

type Loader = (q: AdminQuery, context: AdminContext) => Promise<AdminWidgetData>;

const P = "/admin";

// --- Helpers -----------------------------------------------------------------------

function fromTile(tile: TileData, extra: Partial<WidgetFigure> = {}): WidgetFigure {
  return {
    key: tile.key,
    label: `metrics.items.${tile.key}.name`,
    value: tile.value,
    unit: tile.unit,
    ...(tile.previous !== undefined ? { previous: tile.previous } : {}),
    ...(tile.spark ? { spark: tile.spark } : {}),
    ...(tile.lowerIsBetter ? { lowerIsBetter: true } : {}),
    ...extra,
  };
}

const W = (widget: string, key: string) => `admin.widgets.${widget}.figures.${key}`;

function figure(
  widget: string,
  key: string,
  value: number | null,
  unit: WidgetFigure["unit"] = "count",
  extra: Partial<WidgetFigure> = {},
): WidgetFigure {
  return { key, label: W(widget, key), value, unit, ...extra };
}

const sum = (values: readonly (number | null | undefined)[]) =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0);

const countStatus = (value: number, warnOnly = false): WidgetStatus =>
  value === 0 ? "good" : warnOnly ? "warn" : "bad";

function breakdownRows(data: BreakdownData, limit = 8): WidgetRow[] {
  const items = data.items.filter((item) => (item.value ?? 0) > 0).slice(0, limit);
  const top = Math.max(1, ...items.map((item) => item.value ?? 0));
  return items.map((item) => ({
    id: item.key,
    item: { metric: data.key, key: item.key },
    value: item.value,
    unit: data.unit,
    ratio: (item.value ?? 0) / top,
  }));
}

const today = (q: AdminQuery) => ({ from: q.today, to: q.today });
const lastDays = (q: AdminQuery, days: number) => ({ from: shiftDay(q.today, -(days - 1)), to: q.today });
const monthSoFar = (q: AdminQuery) => ({ from: `${q.today.slice(0, 8)}01` as typeof q.today, to: q.today });

/** A query for another range, without the comparison (one number, not two). */
function within(q: AdminQuery, range: { from: string; to: string }): AdminQuery {
  return { ...q, range: range as AdminQuery["range"], previous: null };
}

/** An event of the catalog over the range: its count (or its distinct users). */
async function eventTotal(q: AdminQuery, event: EventName, calc: "count" | "users" = "count") {
  const { data, error } = await createAdminClient().rpc("metric_event_series", {
    _event: event,
    _calc: calc,
    _from: q.range.from,
    _to: q.range.to,
    _grain: calc === "users" ? "all" : "day",
    _tz: METRICS_TIMEZONE,
    _include_internal: q.view.internal,
    _segment: { ...q.view.segment },
  });
  if (error) throw new Error(`metric_event_series ${event}: ${error.message}`);
  return sum((data ?? []).map((row) => (row.value === null ? null : Number(row.value))));
}

const range = (q: AdminQuery) => ({ from: q.range.from, to: q.range.to });

// --- Operations --------------------------------------------------------------------

type ErrorOverview = {
  new_today: number;
  open: number;
  users: number;
  returned: number;
  top: {
    fingerprint: string;
    code: string;
    message: string;
    page: string;
    occurrences: number;
    users: number;
    status: string;
    returned: boolean;
    last_at: string;
  }[];
};

const errors: Loader = async (q) => {
  const admin = createAdminClient();
  const [overview, fresh, chart] = await Promise.all([
    admin.rpc("admin_error_overview", { _from: q.range.from, _to: q.range.to }),
    loadErrorGroups(q, { status: "new", code: null, latest: false, page: 0 }),
    healthChart(q),
  ]);
  if (overview.error) throw new Error(`admin_error_overview: ${overview.error.message}`);
  const o = (overview.data ?? {}) as unknown as ErrorOverview;
  const top = Array.isArray(o.top) ? o.top : [];
  const groups: WidgetErrorGroup[] = fresh.rows.map((row) => ({
    fingerprint: row.fingerprint,
    code: row.lastCode,
    message: row.message,
    page: row.page,
    occurrences: row.occurrences,
    users: row.users,
    status: row.status,
    returned: row.returnedAt !== null,
    lastAt: row.lastAt,
  }));
  return {
    range: range(q),
    figures: [
      figure("errors", "newToday", o.new_today ?? 0, "count", { status: countStatus(o.new_today ?? 0) }),
      figure("errors", "open", o.open ?? 0, "count", { status: countStatus(o.open ?? 0, true) }),
      figure("errors", "users", o.users ?? 0, "users"),
      figure("errors", "returned", o.returned ?? 0, "count", { status: countStatus(o.returned ?? 0, true) }),
    ],
    rows: top.map((group) => ({
      id: group.fingerprint,
      text: group.code,
      sub: group.message,
      value: group.occurrences,
      unit: "count",
      href: `${P}/chyby?group=${group.fingerprint}`,
      status: group.returned ? "warn" : isErrorGroupStatus(group.status) && group.status === "new" ? "bad" : "warn",
    })),
    rowsTitle: "admin.widgets.errors.top",
    errors: groups,
    chart,
  };
};

const health: Loader = async (q) => {
  const admin = createAdminClient();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [jobs, rates, failedMails, waitingAlerts, webhook, lastWebhook] = await Promise.all([
    cronRuns(q),
    exchangeRateHealth(),
    admin
      .from("error_alert_sends")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", dayAgo),
    admin
      .from("billing_alerts")
      .select("id", { count: "exact", head: true })
      .is("notified_at", null)
      .lt("created_at", dayAgo),
    admin
      .from("stripe_events")
      .select("id", { count: "exact", head: true })
      .in("outcome", ["error", "rejected"])
      .gte("received_at", dayAgo),
    admin
      .from("stripe_events")
      .select("received_at")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  for (const result of [failedMails, waitingAlerts, webhook, lastWebhook]) {
    if (result.error) throw new Error(`health: ${result.error.message}`);
  }
  const staleJobs = jobs.filter(
    (job) => job.lastRunAt !== null && Date.now() - Date.parse(job.lastRunAt) > 26 * 3_600_000,
  ).length;
  const failingJobs = jobs.filter((job) => job.lastOk === false).length;
  const env = envHealth(process.env);
  const missingRequired = env.filter((row) => row.required && row.state !== "ok").length;
  const missingOptional = env.filter((row) => !row.required && row.state !== "ok").length;
  const mailProblems = (failedMails.count ?? 0) + (waitingAlerts.count ?? 0);
  const webhookErrors = webhook.count ?? 0;
  const rateProblems = rates.stale.length + rates.sources.filter((source) => source.lastError).length;

  const rows: WidgetRow[] = [
    {
      id: "cron",
      label: "admin.widgets.health.items.cron",
      subLabel: "admin.widgets.health.subs.cron",
      subValues: { failing: failingJobs, stale: staleJobs, jobs: jobs.length },
      status: failingJobs > 0 ? "bad" : staleJobs > 0 ? "warn" : "good",
      href: `${P}/zdravi`,
    },
    {
      id: "env",
      label: "admin.widgets.health.items.env",
      subLabel: "admin.widgets.health.subs.env",
      subValues: { required: missingRequired, optional: missingOptional },
      status: missingRequired > 0 ? "bad" : missingOptional > 0 ? "warn" : "good",
      href: `${P}/zdravi`,
    },
    {
      id: "email",
      label: "admin.widgets.health.items.email",
      subLabel: "admin.widgets.health.subs.email",
      subValues: { failed: failedMails.count ?? 0, waiting: waitingAlerts.count ?? 0 },
      status: mailProblems > 0 ? "warn" : "good",
      href: `${P}/chyby?tab=alerts`,
    },
    {
      id: "stripe",
      label: "admin.widgets.health.items.stripe",
      subLabel: lastWebhook.data ? "admin.widgets.health.subs.stripe" : "admin.widgets.health.subs.stripeNone",
      subValues: { errors: webhookErrors },
      at: lastWebhook.data?.received_at ?? null,
      status: webhookErrors > 0 ? "bad" : "good",
      href: `${P}/naklady`,
    },
    {
      id: "rates",
      label: "admin.widgets.health.items.rates",
      subLabel: "admin.widgets.health.subs.rates",
      subValues: { stale: rates.stale.length, currencies: rates.currencies },
      status: rateProblems > 0 ? "warn" : "good",
      href: `${P}/zdravi`,
    },
  ];
  const problems = rows.filter((row) => row.status !== "good").length;
  const worst: WidgetStatus = rows.some((row) => row.status === "bad")
    ? "bad"
    : problems > 0
      ? "warn"
      : "good";
  return {
    figures: [figure("health", "problems", problems, "count", { status: worst })],
    rows,
  };
};

const deploy: Loader = async () => {
  const admin = createAdminClient();
  const [events, first] = await Promise.all([
    admin
      .from("error_events")
      .select("fingerprint")
      .eq("app_version", APP_VERSION)
      .order("created_at", { ascending: false })
      .limit(1000),
    admin
      .from("error_events")
      .select("created_at")
      .eq("app_version", APP_VERSION)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (events.error) throw new Error(`deploy errors: ${events.error.message}`);
  const occurrences = events.data?.length ?? 0;
  const groups = new Set((events.data ?? []).map((row) => row.fingerprint)).size;
  const message = (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").split("\n")[0]?.slice(0, 120) ?? "";
  const environment = process.env.VERCEL_ENV ?? "development";
  return {
    figures: [
      figure("deploy", "errors", groups, "count", { status: countStatus(groups, true) }),
      figure("deploy", "occurrences", occurrences),
    ],
    rows: [
      {
        id: "version",
        text: APP_VERSION,
        subLabel: `admin.widgets.deploy.env.${["production", "preview", "development"].includes(environment) ? environment : "development"}`,
        ...(first.data ? { at: first.data.created_at } : {}),
      },
      ...(message ? [{ id: "message", text: message }] : []),
    ],
  };
};

const reports: Loader = async (q) => {
  const [newCount, list, requests] = await Promise.all([
    countNewBugReports(q),
    loadBugReports(q, null, { status: "new", kind: null, source: null }),
    featureRequestCounts(q),
  ]);
  const newRequests = requests.items.find((item) => item.key === "new")?.value ?? 0;
  return {
    figures: [
      figure("reports", "newReports", newCount, "count", { status: countStatus(newCount, true) }),
      figure("reports", "newRequests", newRequests),
    ],
    rows: list.slice(0, 8).map((report) => ({
      id: report.id,
      text: (report.description ?? report.message ?? report.page).slice(0, 140),
      subLabel: `admin.widgets.reports.kinds.${report.kind}`,
      at: report.createdAt,
      href: `${P}/zpetna-vazba?tab=reports&status=new`,
    })),
    rowsTitle: "admin.widgets.reports.latest",
  };
};

const latency: Loader = async (q) => {
  const [routes, pages, errorRate] = await Promise.all([
    routeLatency(q),
    pageLoad(q),
    autoTile(q, "server_error_rate"),
  ]);
  const weighted = (rows: { n: number | null; p95: number | null }[]) => {
    const known = rows.filter((row) => row.n && row.p95 !== null);
    const n = sum(known.map((row) => row.n));
    return n > 0 ? sum(known.map((row) => (row.n ?? 0) * (row.p95 ?? 0))) / n : null;
  };
  const slowest = [...routes, ...pages]
    .filter((row) => row.p95 !== null)
    .sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0))
    .slice(0, 6);
  const top = Math.max(1, ...slowest.map((row) => row.p95 ?? 0));
  return {
    range: range(q),
    figures: [
      figure("latency", "page", weighted(pages), "ms", { lowerIsBetter: true }),
      figure("latency", "route", weighted(routes), "ms", { lowerIsBetter: true }),
      ...(errorRate ? [fromTile(errorRate)] : []),
    ],
    rows: slowest.map((row) => ({
      id: row.key,
      text: row.key,
      value: row.p95,
      unit: "ms",
      ratio: (row.p95 ?? 0) / top,
    })),
    rowsTitle: "admin.widgets.latency.slowest",
  };
};

// --- People ------------------------------------------------------------------------

const newUsers: Loader = async (q) => {
  const [period, day, week, chart] = await Promise.all([
    seriesTile(q, "signups", "sum"),
    seriesTile(within(q, today(q)), "signups", "sum"),
    seriesTile(within(q, lastDays(q, 7)), "signups", "sum"),
    dailyChart(q, "overview.signups", [
      { key: "signups", kind: "bar", color: "green" },
      { key: "users_total", kind: "line", color: "teal", axis: "right" },
    ]),
  ]);
  return {
    range: range(q),
    figures: [
      figure("newUsers", "today", day.value, "users"),
      figure("newUsers", "week", week.value, "users", { spark: week.spark }),
      fromTile(period),
    ],
    chart,
  };
};

const activeUsers: Loader = async (q) => {
  const [dau, wau, mau, stickiness, chart] = await Promise.all([
    seriesTile(q, "dau", "mean"),
    seriesTile(q, "wau", "last"),
    seriesTile(q, "mau", "last"),
    seriesTile(q, "stickiness", "mean"),
    overviewChart(q),
  ]);
  return { range: range(q), figures: [dau, wau, mau, stickiness].map((tile) => fromTile(tile)), chart };
};

const funnel: Loader = async (q) => {
  const [steps, rate] = await Promise.all([
    activationFunnel(q),
    scalarTile(q, "activation_rate", { spark: true }),
  ]);
  return {
    range: range(q),
    figures: [fromTile(rate)],
    rows: steps.map((step) => ({
      id: step.key,
      label: `admin.funnel.steps.${step.key}`,
      value: step.users,
      unit: "users",
      ratio: step.pctOfStart / 100,
      sub: undefined,
    })),
  };
};

const retention: Loader = async (q) => {
  const [d1, d7, d30, churned] = await Promise.all([
    scalarTile(q, "retention_d1"),
    scalarTile(q, "retention_d7", { spark: true }),
    scalarTile(q, "retention_d30"),
    seriesTile(q, "churned", "last", { lowerIsBetter: true }),
  ]);
  return { range: range(q), figures: [fromTile(d7), fromTile(d1), fromTile(d30), fromTile(churned)] };
};

const atRisk: Loader = async (q) => {
  const { data, error } = await createAdminClient().rpc("admin_users_at_risk", {
    _days: 14,
    _limit: 10,
    _include_internal: q.view.internal,
  });
  if (error) throw new Error(`admin_users_at_risk: ${error.message}`);
  const rows = data ?? [];
  const total = rows[0]?.total ?? 0;
  const nameOf = await peopleNamer(rows.map((row) => row.user_id));
  return {
    figures: [figure("atRisk", "users", total, "users", { status: countStatus(total, true) })],
    rows: rows.map((row) => ({
      id: row.user_id,
      text: nameOf(row.user_id),
      item: { metric: "users_by_plan", key: row.plan_key },
      at: row.last_active_at,
      href: `${P}/uzivatele/${row.user_id}`,
    })),
    rowsTitle: "admin.widgets.atRisk.list",
  };
};

const trialsEnding: Loader = async (q) => {
  const data = await trialFields(q);
  const value = (name: string) => data.fields.find((field) => field.name === name)?.value ?? 0;
  const ending = value("ending_this_week");
  return {
    figures: [
      figure("trialsEnding", "ending", ending, "count", { status: ending > 0 ? "warn" : undefined }),
      figure("trialsEnding", "running", value("running")),
      figure("trialsEnding", "converted", value("converted")),
      figure("trialsEnding", "expired", value("expired")),
    ],
  };
};

const countries: Loader = async (q) => {
  const [byCountry, byLocale] = await Promise.all([
    distribution(q, "users_by_country"),
    distribution(q, "users_by_locale"),
  ]);
  const total = sum(byCountry.items.map((item) => item.value));
  return {
    range: range(q),
    figures: [figure("countries", "countries", byCountry.items.filter((item) => (item.value ?? 0) > 0).length)],
    rows: breakdownRows(byCountry, 8).map((row) => ({ ...row, sub: undefined })),
    rowsTitle: "metrics.items.users_by_country.name",
    more: breakdownRows(byLocale, 6),
    moreTitle: "metrics.items.users_by_locale.name",
    ...(total ? {} : {}),
  };
};

const recentSignups: Loader = async (q) => {
  const { rows } = await loadUsers({ view: q.view, query: "", sort: "signup", page: 0 });
  const shown = rows.slice(0, 10);
  const nameOf = await peopleNamer(shown.map((row) => row.userId));
  return {
    figures: [],
    rows: shown.map((row) => ({
      id: row.userId,
      text: nameOf(row.userId),
      item: { metric: "users_by_plan", key: row.plan },
      at: row.signedUpAt,
      href: `${P}/uzivatele/${row.userId}`,
    })),
  };
};

// --- Money -------------------------------------------------------------------------

/** Stripe's test mode: the numbers are the internal test accounts' payments, labelled so. */
function moneyQuery(q: AdminQuery): { q: AdminQuery; testData: boolean } {
  const testData = stripeModeOfKey(process.env.STRIPE_SECRET_KEY) === "test";
  return testData ? { q: { ...q, view: { ...q.view, internal: true } }, testData } : { q, testData };
}

/** The currency with the most revenue in the rows (none without payments). */
function mainCurrency(rows: PaymentsRow[], fallback: string[] = []): string | null {
  const sorted = [...rows].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  return sorted[0]?.currency ?? fallback[0] ?? null;
}

const revenue: Loader = async (input) => {
  const { q, testData } = moneyQuery(input);
  const [period, previous, day, month, mrr] = await Promise.all([
    paymentsByCurrency(q),
    q.previous ? paymentsByCurrency(within(q, q.previous)) : Promise.resolve(null),
    paymentsByCurrency(within(q, today(q))),
    paymentsByCurrency(within(q, monthSoFar(q))),
    mrrByCurrency(q),
  ]);
  const currency = mainCurrency(period, [...month.map((row) => row.currency), ...mrr.items.map((item) => item.key)]);
  const of = (rows: PaymentsRow[] | null) =>
    rows ? (rows.find((row) => row.currency === currency)?.revenue ?? 0) : undefined;
  const mrrValue = mrr.items.find((item) => item.key === currency)?.value ?? 0;
  const money = currency ? { currency } : {};
  const figures: WidgetFigure[] = currency
    ? [
        figure("revenue", "period", of(period) ?? 0, "money", {
          ...money,
          ...(previous ? { previous: of(previous) ?? 0 } : {}),
        }),
        figure("revenue", "today", of(day) ?? 0, "money", money),
        figure("revenue", "month", of(month) ?? 0, "money", money),
        figure("revenue", "mrr", mrrValue, "money", money),
      ]
    : // No payment in any currency yet: zeros without a currency, never a made-up one.
      (["period", "today", "month", "mrr"] as const).map((key) => figure("revenue", key, 0, "count"));
  // Other currencies never add up with the main one: each on its own line.
  const others = period
    .filter((row) => row.currency !== currency && (row.revenue ?? 0) > 0)
    .map((row) => ({
      id: row.currency,
      text: row.currency,
      value: row.revenue,
      unit: "money" as const,
      currency: row.currency,
      subLabel: "admin.widgets.revenue.paying",
      subValues: { count: row.payingAccounts ?? 0 },
    }));
  return {
    range: range(q),
    testData,
    figures,
    rows: [
      ...period
        .filter((row) => row.currency === currency)
        .map((row) => ({
          id: `${row.currency}-paying`,
          label: "admin.widgets.revenue.payingAccounts",
          value: row.payingAccounts,
          unit: "users" as const,
        })),
      ...period
        .filter((row) => row.currency === currency && (row.refunded ?? 0) > 0)
        .map((row) => ({
          id: `${row.currency}-refunded`,
          label: "admin.widgets.revenue.refunded",
          value: row.refunded,
          unit: "money" as const,
          currency: row.currency,
          status: "warn" as const,
        })),
      ...others,
    ],
  };
};

const payingByPlan: Loader = async (input) => {
  const { q, testData } = moneyQuery(input);
  const data = await breakdown(q, "paying_accounts");
  return {
    range: range(q),
    testData,
    figures: [figure("payingByPlan", "paying", sum(data.items.map((item) => item.value)), "users")],
    rows: breakdownRows(data).map((row) => ({ ...row, item: { metric: "users_by_plan", key: row.id } })),
  };
};

const subscriptions: Loader = async (input) => {
  const { q, testData } = moneyQuery(input);
  const [started, cancelled, reasons] = await Promise.all([
    eventTotal(q, "checkout_completed"),
    eventTotal(q, "subscription_cancelled"),
    breakdown(q, "subscription_cancellations"),
  ]);
  return {
    range: range(q),
    testData,
    figures: [
      figure("subscriptions", "started", started),
      figure("subscriptions", "cancelled", cancelled, "count", {
        lowerIsBetter: true,
        status: cancelled > 0 ? "warn" : undefined,
      }),
    ],
    rows: breakdownRows(reasons, 6),
    rowsTitle: "admin.widgets.subscriptions.reasons",
  };
};

const failedPayments: Loader = async (input) => {
  const { q, testData } = moneyQuery(input);
  const [attempts, payments] = await Promise.all([breakdown(q, "failed_payments"), paymentsByCurrency(q)]);
  const failed = sum(attempts.items.map((item) => item.value));
  return {
    range: range(q),
    testData,
    figures: [
      figure("failedPayments", "failed", failed, "count", { status: countStatus(failed), lowerIsBetter: true }),
      figure("failedPayments", "unpaid", sum(payments.map((row) => row.failedPayments)), "count", {
        lowerIsBetter: true,
      }),
    ],
    rows: breakdownRows(attempts, 4),
  };
};

const promo: Loader = async () => {
  const codes = await loadPromoCodes();
  const due = new Map<string, number>();
  for (const code of codes) {
    for (const [currency, amount] of Object.entries(code.stats.due)) {
      due.set(currency, (due.get(currency) ?? 0) + Number(amount ?? 0));
    }
  }
  const dueRows = [...due.entries()].filter(([, amount]) => amount > 0);
  const top = codes
    .filter((code) => code.stats.redemptionsSince > 0)
    .sort((a, b) => b.stats.redemptionsSince - a.stats.redemptionsSince)
    .slice(0, 6);
  const max = Math.max(1, ...top.map((code) => code.stats.redemptionsSince));
  return {
    figures: [
      ...dueRows.slice(0, 1).map(([currency, amount]) =>
        figure("promo", "due", amount, "money", { currency, status: "warn" }),
      ),
      figure("promo", "redemptions", sum(codes.map((code) => code.stats.redemptionsSince))),
      figure("promo", "paying", sum(codes.map((code) => code.stats.payingSince))),
    ],
    rows: [
      ...dueRows.slice(1).map(([currency, amount]) => ({
        id: `due-${currency}`,
        label: W("promo", "due"),
        value: amount,
        unit: "money" as const,
        currency,
      })),
      ...top.map((code) => ({
        id: code.id,
        text: code.code,
        value: code.stats.redemptionsSince,
        unit: "count" as const,
        ratio: code.stats.redemptionsSince / max,
        href: `${P}/promo-kody/${code.id}`,
      })),
    ],
    rowsTitle: "admin.widgets.promo.top",
  };
};

/** Costs are kept in CZK in the administration (CLAUDE.md), so the margin is the CZK revenue less them. */
const COSTS_CURRENCY = "CZK";

const margin: Loader = async (input) => {
  const { q, testData } = moneyQuery(input);
  const [costs, payments, plans] = await Promise.all([
    costBreakdownFields(input),
    paymentsByCurrency(q),
    marginByPlanRows(input),
  ]);
  const costCzk = costs.fields.find((field) => field.name === "total_czk")?.value ?? 0;
  const costUsd = costs.fields.find((field) => field.name === "total_usd")?.value ?? 0;
  const revenueCzk = payments.find((row) => row.currency === COSTS_CURRENCY)?.revenue ?? 0;
  const result = revenueCzk - costCzk;
  return {
    range: range(q),
    testData,
    figures: [
      figure("margin", "result", result, "money", {
        currency: COSTS_CURRENCY,
        status: result < 0 ? "bad" : "good",
      }),
      figure("margin", "revenue", revenueCzk, "money", { currency: COSTS_CURRENCY }),
      figure("margin", "costs", costCzk, "czk", { lowerIsBetter: true }),
      figure("margin", "costsUsd", costUsd, "usd", { lowerIsBetter: true }),
    ],
    rows: plans.map((row) => ({
      id: row.plan,
      item: { metric: "users_by_plan", key: row.plan },
      value: row.marginShare === null ? null : row.marginShare * 100,
      unit: "percent" as const,
      status: row.marginShare !== null && row.marginShare < 0 ? ("bad" as const) : undefined,
    })),
    rowsTitle: "admin.widgets.margin.byPlan",
    more: payments
      .filter((row) => row.currency !== COSTS_CURRENCY && (row.revenue ?? 0) > 0)
      .map((row) => ({
        id: row.currency,
        text: row.currency,
        value: row.revenue,
        unit: "money" as const,
        currency: row.currency,
      })),
    moreTitle: "admin.widgets.margin.otherCurrencies",
  };
};

// --- AI ----------------------------------------------------------------------------

const aiSpend: Loader = async (q) => {
  const [month, day] = await Promise.all([loadAiCapsOverview(), loadPeriodSpend(q.today, q.today)]);
  const cap = month.caps.monthlyUsd;
  const share = cap > 0 ? month.spentUsd / cap : null;
  const status: WidgetStatus | undefined =
    share === null ? undefined : share >= 1 ? "bad" : share >= month.caps.warnShare ? "warn" : "good";
  return {
    figures: [
      figure("aiSpend", "month", month.spentUsd, "usd", { status }),
      figure("aiSpend", "today", day.spentUsd, "usd"),
      figure("aiSpend", "cap", cap, "usd"),
      figure("aiSpend", "share", share === null ? null : share * 100, "percent", { status }),
    ],
    rows: [
      {
        id: "calls",
        label: W("aiSpend", "callsToday"),
        value: day.calls,
        unit: "count",
      },
      ...(month.topUserSpentUsd !== null
        ? [{ id: "top", label: W("aiSpend", "topUser"), value: month.topUserSpentUsd, unit: "usd" as const }]
        : []),
    ],
  };
};

const aiPerUser: Loader = async (q) => {
  const tile = await scalarTile(q, "ai_cost_per_active_user", { spark: true, lowerIsBetter: true });
  return { range: range(q), figures: [fromTile(tile)] };
};

const aiTopUsersWidget: Loader = async (q) => {
  const top = (await aiTopUsers(q)).slice(0, 8);
  const nameOf = await peopleNamer(top.map((row) => row.userId));
  const max = Math.max(0.01, ...top.map((row) => row.costUsd ?? 0));
  return {
    range: range(q),
    figures: [figure("aiTopUsers", "top", top[0]?.costUsd ?? 0, "usd")],
    rows: top.map((row) => ({
      id: row.userId,
      text: nameOf(row.userId),
      value: row.costUsd,
      unit: "usd",
      ratio: (row.costUsd ?? 0) / max,
      href: `${P}/uzivatele/${row.userId}`,
    })),
  };
};

const aiByFeatureWidget: Loader = async (q) => {
  const [features, models] = await Promise.all([aiByFeature(q), aiByModel(q)]);
  const byCost = <T extends { costUsd: number | null }>(rows: T[]) =>
    [...rows].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
  const rowsOf = (rows: Awaited<ReturnType<typeof aiByFeature>>, limit: number): WidgetRow[] => {
    const sorted = byCost(rows).slice(0, limit);
    const max = Math.max(0.01, ...sorted.map((row) => row.costUsd ?? 0));
    return sorted.map((row) => ({
      id: row.key,
      text: row.key,
      value: row.costUsd,
      unit: "usd",
      ratio: (row.costUsd ?? 0) / max,
      subLabel: "admin.widgets.aiByFeature.calls",
      subValues: { count: row.calls ?? 0 },
    }));
  };
  return {
    range: range(q),
    figures: [figure("aiByFeature", "total", sum(features.map((row) => row.costUsd)), "usd")],
    rows: rowsOf(features, 8),
    rowsTitle: "admin.widgets.aiByFeature.features",
    more: rowsOf(models, 6),
    moreTitle: "admin.widgets.aiByFeature.models",
  };
};

const aiEconomy: Loader = async () => {
  const [models, month] = await Promise.all([loadModelsOverview(), loadAiCapsOverview()]);
  const on = models.settings.economy || models.economyByBudget;
  const state = !on ? "off" : models.settings.economy ? "manual" : "budget";
  const cap = month.caps.monthlyUsd;
  return {
    figures: [
      {
        key: "state",
        label: `admin.widgets.aiEconomy.${state}`,
        value: cap > 0 ? (month.spentUsd / cap) * 100 : null,
        unit: "percent",
        status: on ? "warn" : "good",
      },
    ],
    rows: [
      {
        id: "threshold",
        label: "admin.widgets.aiEconomy.threshold",
        value: models.warnShare * 100,
        unit: "percent",
      },
    ],
  };
};

const aiSavings: Loader = async () => {
  const models = await loadModelsOverview();
  const recommendations = models.recommendations.slice(0, 6);
  const saved = sum(recommendations.map((row) => (row.monthlyUsd !== null && row.monthlyUsd > 0 ? row.monthlyUsd : 0)));
  return {
    figures: [figure("aiSavings", "monthly", saved, "usd", { status: saved > 0 ? "warn" : "good" })],
    rows: recommendations.map((row) => ({
      id: `${row.feature}-${row.kind}`,
      label: `admin.ai.models.features.${row.feature}.name`,
      subLabel: `admin.widgets.aiSavings.kinds.${row.kind}`,
      value: row.monthlyUsd,
      unit: "usd",
      href: `${P}/ai?tab=models#kde-usetrit`,
    })),
  };
};

// --- Product -----------------------------------------------------------------------

const topFeatures: Loader = async (q) => {
  const rows = (await featureAdoption(q))
    .filter((row) => (row.users ?? 0) > 0)
    .sort((a, b) => (b.users ?? 0) - (a.users ?? 0))
    .slice(0, 8);
  const max = Math.max(1, ...rows.map((row) => row.users ?? 0));
  return {
    range: range(q),
    figures: [figure("topFeatures", "sections", rows.length)],
    rows: rows.map((row) => ({
      id: row.section,
      label: `admin.users.sections.${row.section}`,
      value: row.users,
      unit: "users",
      ratio: (row.users ?? 0) / max,
      subLabel: "admin.widgets.topFeatures.share",
      subValues: { pct: Math.round(row.pct ?? 0) },
      href: `${P}/funkce`,
    })),
  };
};

const tutorial: Loader = async (q) => {
  const [started, finished] = await Promise.all([
    eventTotal(q, "tutorial_started", "users"),
    eventTotal(q, "tutorial_finished", "users"),
  ]);
  const modes = await breakdown(q, "tutorial_finished");
  return {
    range: range(q),
    figures: [
      figure("tutorial", "rate", started > 0 ? (finished / started) * 100 : null, "percent"),
      figure("tutorial", "started", started, "users"),
      figure("tutorial", "finished", finished, "users"),
    ],
    rows: breakdownRows(modes, 4),
  };
};

const game: Loader = async (q) => {
  const [levels, streaks] = await Promise.all([
    distribution(q, "level_distribution"),
    distribution(q, "streaks"),
  ]);
  return {
    range: range(q),
    figures: [figure("game", "players", sum(levels.items.map((item) => item.value)), "users")],
    rows: breakdownRows(levels, 8),
    rowsTitle: "metrics.items.level_distribution.name",
    more: breakdownRows(streaks, 8),
    moreTitle: "metrics.items.streaks.name",
  };
};

const scheduler: Loader = async (q) => {
  const [created, confirmed, cancelled] = await Promise.all([
    eventTotal(q, "booking_created"),
    eventTotal(q, "booking_confirmed"),
    eventTotal(q, "booking_cancelled"),
  ]);
  return {
    range: range(q),
    figures: [
      figure("scheduler", "created", created),
      figure("scheduler", "confirmed", confirmed),
      figure("scheduler", "cancelled", cancelled, "count", { lowerIsBetter: true }),
    ],
  };
};

const mcp: Loader = async (q) => {
  const [connected, calls, users] = await Promise.all([
    eventTotal(q, "mcp_client_connected"),
    eventTotal(q, "mcp_tool_called"),
    eventTotal(q, "mcp_tool_called", "users"),
  ]);
  return {
    range: range(q),
    figures: [
      figure("mcp", "calls", calls),
      figure("mcp", "connected", connected),
      figure("mcp", "users", users, "users"),
    ],
  };
};

const satisfaction: Loader = async (q) => {
  const summary = await loadSatisfactionSummary(q);
  return {
    range: range(q),
    figures: [
      figure("satisfaction", "average", summary.average, "count"),
      figure("satisfaction", "responses", summary.responses),
    ],
    rows: [...breakdownRows(summary.distribution, 5)].sort((a, b) => b.id.localeCompare(a.id)),
  };
};

// --- Management --------------------------------------------------------------------

const audit: Loader = async (_q, context) => {
  const { rows } = await loadAuditPage(context, 0, "–");
  return {
    figures: [],
    rows: rows.slice(0, 8).map((row) => ({
      id: String(row.id),
      text: row.who || "–",
      sub: `${row.time} · ${row.target}`,
      subLabel: undefined,
      href: `${P}/audit`,
    })),
  };
};

const waiting: Loader = async (q, context) => {
  const admin = createAdminClient();
  const money = adminCan(context, "viewMoney") && adminCan(context, "managePayouts");
  const [reportsNew, badge, payouts, catalog] = await Promise.all([
    countNewBugReports(q),
    admin.rpc("admin_error_badge", { _days: 30 }),
    money
      ? admin.from("partner_payouts").select("id", { count: "exact", head: true }).in("status", ["pending", "approved"])
      : Promise.resolve(null),
    adminCan(context, "editPlans") ? loadCatalogVersions() : Promise.resolve(null),
  ]);
  if (badge.error) throw new Error(`admin_error_badge: ${badge.error.message}`);
  if (payouts?.error) throw new Error(`partner_payouts: ${payouts.error.message}`);
  const items: WidgetRow[] = [
    { id: "errors", label: W("waiting", "errors"), value: badge.data ?? 0, unit: "count" as const, href: `${P}/chyby?status=new` },
    { id: "reports", label: W("waiting", "reports"), value: reportsNew, unit: "count" as const, href: `${P}/zpetna-vazba?tab=reports&status=new` },
    ...(payouts
      ? [{ id: "payouts", label: W("waiting", "payouts"), value: payouts.count ?? 0, unit: "count" as const, href: `${P}/promo-kody` }]
      : []),
    ...(catalog
      ? [{ id: "draft", label: W("waiting", "draft"), value: catalog.draft ? 1 : 0, unit: "count" as const, href: `${P}/tarify#plans-editor` }]
      : []),
  ].map((row) => ({ ...row, status: (row.value ?? 0) > 0 ? ("warn" as const) : ("good" as const) }));
  const open = sum(items.map((row) => row.value));
  return {
    figures: [figure("waiting", "total", open, "count", { status: open > 0 ? "warn" : "good" })],
    rows: items,
  };
};

const LOADERS: Record<Exclude<AdminWidgetKey, "quickActions">, Loader> = {
  errors,
  health,
  deploy,
  reports,
  latency,
  newUsers,
  activeUsers,
  funnel,
  retention,
  atRisk,
  trialsEnding,
  countries,
  recentSignups,
  revenue,
  payingByPlan,
  subscriptions,
  failedPayments,
  promo,
  margin,
  aiSpend,
  aiPerUser,
  aiTopUsers: aiTopUsersWidget,
  aiByFeature: aiByFeatureWidget,
  aiEconomy,
  aiSavings,
  topFeatures,
  tutorial,
  game,
  scheduler,
  mcp,
  satisfaction,
  audit,
  waiting,
};

/** The widget's data, or null for a widget that has none of its own (quick actions). */
export async function loadAdminWidget(
  key: AdminWidgetKey,
  q: AdminQuery,
  context: AdminContext,
): Promise<AdminWidgetData | null> {
  if (key === "quickActions") return null;
  return LOADERS[key](q, context);
}
