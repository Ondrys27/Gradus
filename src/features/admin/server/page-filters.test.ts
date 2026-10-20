import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSectionKey } from "../nav";

/**
 * Every filter a page of the administration offers reaches every query of
 * that page (step 14.5): the page's loaders run against a recording admin
 * client, through the real registry plan (planMetric), and each database call
 * must carry the period, the internal accounts and each segment value — or be
 * one of the named exceptions below. A filter a page does not offer must not
 * reach any of its queries. The SQL side (that the functions really filter)
 * is in src/lib/supabase/admin-users-schema.test.ts and metrics-schema.test.ts.
 */

vi.mock("server-only", () => ({}));
type Call = { fn: string; args: Record<string, unknown> };
const calls: Call[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: [], error: null };
    },
  }),
}));
vi.mock("./people", () => ({ peopleNamer: async () => (id: string) => id }));

const pd = await import("./page-data");
const { adminQuery } = await import("./metrics-data");
const { loadUsers } = await import("./users-data");
const { loadFeatureRequests, loadNpsComments } = await import("./feedback-data");
const { explorerChart } = await import("./explorer-data");
const { PAGE_FILTERS } = await import("../filters");
type AdminFilter = (typeof PAGE_FILTERS)[AdminSectionKey][number];
type AdminQuery = ReturnType<typeof adminQuery>;

/** Every filter switched on, each segment to a value that is not a default. */
const SEGMENT = {
  plan: "beta",
  mode: "tool",
  industry: "it",
  locale: "en",
  country: "SK",
  role: "worker",
  device: "mobile",
} as const;
const ALL_ON = {
  period: "custom",
  from: "2026-09-01",
  to: "2026-09-10",
  internal: "1",
  ...SEGMENT,
};
const RANGE = { from: "2026-09-01", to: "2026-09-10" };
const PREVIOUS = { from: "2026-08-22", to: "2026-08-31" };

type Loader = (q: AdminQuery) => Promise<unknown>;

/** What each page loads, the same functions its page.tsx renders. */
const PAGE_LOADERS: Record<AdminSectionKey, Loader[]> = {
  overview: [pd.overviewTiles, pd.overviewChart],
  growth: [pd.growthTiles, pd.growthCharts, pd.growthFields, pd.growthDistributions],
  activation: [pd.activationTiles, pd.activationFunnel, pd.activationBreakdowns],
  retention: [
    pd.retentionTiles,
    pd.retentionCohorts,
    pd.retentionHeatmap,
    pd.retentionCharts,
    pd.retentionSessions,
    pd.retentionActiveDays,
    pd.retentionBreakdowns,
  ],
  features: [
    pd.featureAdoption,
    pd.milestoneDaysToComplete,
    pd.dealValue,
    pd.generationKeywords,
    pd.callTimeFields,
    pd.financeValue,
    pd.workerInviteFields,
    ...pd.FEATURE_SECTIONS.flatMap((section): Loader[] => [
      (q) => pd.featureSectionTiles(q, section),
      (q) => pd.featureSectionBreakdowns(q, section),
      (q) => pd.featureSectionTrend(q, section),
    ]),
  ],
  // The budget and the caps cards are always this calendar month of every
  // account (the budget is monthly and shared); they take no view at all.
  ai: [
    pd.aiTiles,
    pd.aiCostChart,
    pd.aiByFeature,
    pd.aiByModel,
    pd.aiBreakdowns,
    pd.aiErrors,
    pd.jarvisConversations,
    pd.aiTopUsers,
  ],
  game: [pd.gameTiles, pd.gameChart, pd.gameBreakdowns, pd.xpSources],
  costs: [pd.costsTiles, pd.costBreakdownFields, pd.marginByPlanRows, pd.trialFields, pd.costsBreakdowns],
  health: [pd.healthTiles, pd.healthChart, pd.routeLatency, pd.pageLoad, pd.healthBreakdowns, pd.cronRuns],
  feedback: [
    (q) => import("./feedback-data").then((m) => m.loadNpsSummary(q)),
    (q) => import("./feedback-data").then((m) => m.jarvisAnswerRatings(q)),
    (q) => import("./feedback-data").then((m) => m.featureRequestCounts(q)),
    (q) => loadFeatureRequests(q, null),
    (q) => loadNpsComments(q),
  ],
  explorer: [(q) => explorerChart(q, { event: "app_opened", calc: "count", prop: null, grain: "day" })],
  users: [(q) => loadUsers({ view: q.view, query: "", sort: "activity", page: 0 })],
  audit: [],
  plans: [],
  admins: [],
};

/** Queries that rightly ignore a filter their page offers, and why. */
const EXCEPTIONS: { fn: string; filters: readonly AdminFilter[]; reason: string }[] = [
  {
    fn: "metric_distribution",
    filters: ["period"],
    reason: "accounts split by an attribute now (the card says so)",
  },
  { fn: "metric_trials", filters: ["period"], reason: "trials running now" },
  {
    fn: "metric_waitlist",
    filters: ["internal", "plan", "mode", "industry", "locale", "country", "role"],
    reason: "people on the waiting list have no account yet",
  },
  {
    fn: "metric_generation_keywords",
    filters: ["internal", "plan", "mode", "industry", "locale", "country", "role"],
    reason: "an anonymous daily aggregate without accounts",
  },
  { fn: "metric_cron_runs", filters: ["period"], reason: "the last run and the last 7 days of each job" },
  { fn: "admin_feature_requests", filters: ["period"], reason: "the backlog now, like its status counts" },
];

function isExempt(call: Call, filter: AdminFilter): boolean {
  return EXCEPTIONS.some((e) => e.fn === call.fn && e.filters.includes(filter));
}

function segmentOf(call: Call): Record<string, unknown> {
  return (call.args._segment ?? {}) as Record<string, unknown>;
}

function carries(call: Call, filter: AdminFilter): boolean {
  switch (filter) {
    case "period": {
      const from = call.args._from;
      const to = call.args._to;
      return (
        typeof from === "string" &&
        typeof to === "string" &&
        from >= PREVIOUS.from &&
        to <= RANGE.to
      );
    }
    case "compare":
      return call.args._from === PREVIOUS.from && call.args._to === PREVIOUS.to;
    case "internal":
      return call.args._include_internal === true;
    default:
      return segmentOf(call)[filter] === SEGMENT[filter];
  }
}

const describeCall = (call: Call) =>
  `${call.fn}(${String(call.args._metrics ?? call.args._event ?? call.args._kind ?? "")})`;

async function load(page: AdminSectionKey, params: Record<string, string>): Promise<Call[]> {
  calls.length = 0;
  const q = adminQuery(params, page);
  await Promise.all(PAGE_LOADERS[page].map((loader) => loader(q)));
  return [...calls];
}

const ALL_FILTERS: readonly AdminFilter[] = [
  "period",
  "compare",
  "internal",
  ...(Object.keys(SEGMENT) as (keyof typeof SEGMENT)[]),
];

beforeEach(() => {
  calls.length = 0;
});

const PAGES = Object.keys(PAGE_LOADERS) as AdminSectionKey[];

describe("every filter a page offers applies to its queries", () => {
  for (const page of PAGES.filter((p) => PAGE_LOADERS[p].length > 0)) {
    for (const filter of PAGE_FILTERS[page]) {
      it(`${page} × ${filter}`, async () => {
        const made = await load(page, ALL_ON);
        expect(made.length, "the page asks the database").toBeGreaterThan(0);
        if (filter === "compare") {
          // The comparison adds the previous period to the page; off, it is gone.
          expect(made.some((call) => carries(call, "compare"))).toBe(true);
          const off = await load(page, { ...ALL_ON, cmp: "0" });
          expect(off.filter((call) => carries(call, "compare")).map(describeCall)).toEqual([]);
          return;
        }
        const missing = made.filter((call) => !carries(call, filter) && !isExempt(call, filter));
        expect(missing.map(describeCall)).toEqual([]);
        if (filter === "period") {
          expect(made.some((c) => c.args._from === RANGE.from && c.args._to === RANGE.to)).toBe(true);
        }
      });
    }
  }
});

describe("a filter a page does not offer reaches none of its queries", () => {
  for (const page of PAGES.filter((p) => PAGE_LOADERS[p].length > 0)) {
    const hidden = ALL_FILTERS.filter((f) => !PAGE_FILTERS[page].includes(f) && f !== "period");
    if (hidden.length === 0) continue;
    it(`${page} ignores ${hidden.join(", ")}`, async () => {
      const made = await load(page, ALL_ON);
      for (const filter of hidden) {
        expect(made.filter((call) => carries(call, filter)).map(describeCall), filter).toEqual([]);
      }
    });
  }
});

describe("the Users page", () => {
  it("passes the plan, country and internal accounts to the list (the 'beta users' bug)", async () => {
    const made = await load("users", { plan: "beta", country: "CZ", internal: "1" });
    expect(made).toHaveLength(1);
    expect(made[0].fn).toBe("metric_admin_users");
    expect(made[0].args).toMatchObject({
      _include_internal: true,
      _segment: { plan: "beta", country: "CZ" },
    });
  });

  it("leaves internal accounts out by default", async () => {
    const [call] = await load("users", {});
    expect(call.args).toMatchObject({ _include_internal: false, _segment: {} });
  });
});
