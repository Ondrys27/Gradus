// @vitest-environment node
//
// Metric calculations on prepared data: DAU and MAU, a sign-in alone is not
// activity, D7 retention, the activation funnel, cost per active user,
// internal accounts left out, money kept per currency, the nightly summaries
// and that nobody but the server can compute or read metrics. Runs every
// migration in PGlite with the same Supabase stubs as schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { costPerActiveUser, type CostInputs } from "@/config/costs";
import { EVENTS } from "@/lib/analytics/events";
import { DAILY_METRIC_KEYS, METRICS } from "@/lib/analytics/metrics";
import { combineMetric, planMetric } from "@/lib/analytics/metrics-plan";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const TZ = "Europe/Prague";

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema extensions;
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid
);
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  _parts := string_to_array(name, '/');
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
alter table storage.objects enable row level security;
grant all on storage.objects, storage.buckets to authenticated;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role, supabase_auth_admin;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on functions to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
`;

type Row = Record<string, unknown>;

let db: PGlite;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function asUser(uid: string) {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
}
async function asServiceRole() {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
}
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function createAuthUser(email = `${crypto.randomUUID()}@example.com`) {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [email],
  );
  return id;
}

/** Today in Prague; every fixture is placed relative to it. */
let today: string;
function day(offset: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
/** An instant on a Prague calendar day at the given local hour. */
function at(offset: number, hour = 10): string {
  return `${day(offset)} ${String(hour).padStart(2, "0")}:00`;
}

async function signedUp(id: string, offset: number) {
  await asServer();
  await db.query(
    `update profiles set created_at = ($2::timestamp at time zone '${TZ}') where id = $1`,
    [id, at(offset, 9)],
  );
}
async function track(
  userId: string,
  event: string,
  offset: number,
  props: Record<string, unknown> = {},
  hour = 10,
) {
  await asServer();
  await db.query(
    `insert into analytics_events (user_id, event, props, created_at, device)
     values ($1, $2, $3, ($4::timestamp at time zone '${TZ}'), 'desktop')`,
    [userId, event, JSON.stringify(props), at(offset, hour)],
  );
}

type Series = { metric_key: string; day: string; value: string };
async function series(metrics: string[], from: string, to: string, internal = false, segment = {}) {
  await asServiceRole();
  const result = await rows<Series>(
    `select metric_key, day::text as day, value::text as value
     from public.metric_series($1, $2::date, $3::date, '${TZ}', $4, $5)`,
    [metrics, from, to, internal, JSON.stringify(segment)],
  );
  return (metric: string, d: string) =>
    Number(result.find((r) => r.metric_key === metric && r.day === d)?.value);
}

let owner: string; // first account: owner, internal
let alice: string;
let bob: string;
let carol: string; // only signs in and looks around
let demo: string; // internal

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  today = (await one<{ d: string }>(`select ((now() at time zone '${TZ}')::date)::text as d`)).d;

  owner = await createAuthUser("owner@example.com");
  alice = await createAuthUser();
  bob = await createAuthUser();
  carol = await createAuthUser();
  demo = await createAuthUser("demo@gradus.local");

  for (const id of [owner, alice, bob, carol, demo]) await signedUp(id, -40);

  // Alice: active on day -40 (sign-up), -33 (D7), -15 and -2.
  await track(alice, "milestone_created", -40, {
    where: "form",
    category: "work",
    has_reward: false,
    has_target_date: false,
  });
  await track(alice, "task_completed", -33, { where: "milestone" });
  await track(alice, "contact_created", -15, {
    source: "manual",
    where: "contacts",
    has_email: true,
    has_phone: true,
    has_website: false,
  });
  await track(alice, "deal_created", -2, { currency: "CZK", has_contact: true });
  // Bob: active the day after signing up and on day -2.
  await track(bob, "milestone_created", -39, {
    where: "form",
    category: "work",
    has_reward: true,
    has_target_date: false,
  });
  await track(bob, "timer_started", -2);
  // Carol: signs in and views pages, never does anything.
  await track(carol, "signed_in", -2);
  await track(carol, "page_viewed", -2, { route: "/app", section: "dashboard", initial: true });
  // The demo account is busy every day, but internal.
  await track(demo, "timer_started", -2);
  await track(demo, "timer_started", -33);

  // Onboarding: Alice and Bob finished it.
  await asServer();
  await db.query(
    `update profiles set onboarding_completed_at = created_at + interval '1 hour' where id = any($1)`,
    [[alice, bob]],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("event catalog", () => {
  it("matches src/lib/analytics/events.ts exactly", async () => {
    await asServer();
    const stored = await rows<{ event: string; section: string; active: boolean }>(
      `select event, section, active from analytics_event_catalog order by event`,
    );
    const expected = Object.entries(EVENTS)
      .map(([event, def]) => ({ event, section: def.section, active: def.active }))
      .sort((a, b) => (a.event < b.event ? -1 : 1));
    expect(stored).toEqual(expected);
  });

  it("knows the same daily metrics as the registry", async () => {
    await asServer();
    const keys = await rows<{ metric_key: string }>(`select metric_key from metric_daily_keys()`);
    expect(keys.map((k) => k.metric_key).sort()).toEqual([...DAILY_METRIC_KEYS].sort());
  });
});

describe("active users", () => {
  it("counts DAU, WAU and MAU from meaningful actions", async () => {
    const value = await series(["dau", "wau", "mau", "stickiness"], day(-40), day(0));
    expect(value("dau", day(-2))).toBe(2); // Alice and Bob
    expect(value("dau", day(-15))).toBe(1);
    expect(value("dau", day(-3))).toBe(0);
    expect(value("wau", day(-2))).toBe(2);
    expect(value("mau", day(-2))).toBe(2);
    expect(value("mau", day(-16))).toBe(2); // -40 is outside, -33 and -39 inside
    expect(value("mau", day(0))).toBe(2);
    expect(value("stickiness", day(-2))).toBe(1);
  });

  it("does not count signing in or viewing pages as activity", async () => {
    const value = await series(["dau", "events"], day(-2), day(-2));
    expect(value("dau", day(-2))).toBe(2);
    expect(value("events", day(-2))).toBe(4); // Carol's two events exist, she is not active
  });

  it("leaves internal accounts out unless asked", async () => {
    const without = await series(["dau", "signups"], day(-40), day(-2));
    expect(without("dau", day(-2))).toBe(2);
    expect(without("signups", day(-40))).toBe(3);
    const withInternal = await series(["dau", "signups"], day(-40), day(-2), true);
    expect(withInternal("dau", day(-2))).toBe(3);
    expect(withInternal("signups", day(-40))).toBe(5);
  });

  it("splits new and returning active users", async () => {
    const value = await series(["new_active", "returning_active"], day(-40), day(-2));
    expect(value("new_active", day(-40))).toBe(1);
    expect(value("returning_active", day(-2))).toBe(2);
    expect(value("new_active", day(-2))).toBe(0);
  });

  it("refuses an unknown segment instead of returning everyone", async () => {
    await asServiceRole();
    await expect(
      db.query(
        `select * from public.metric_series(array['dau'], $1::date, $1::date, '${TZ}', false, '{"plna":"pro"}')`,
        [day(-2)],
      ),
    ).rejects.toThrow(/unknown metric segment/);
  });
});

describe("retention", () => {
  it("computes D1, D7 and D30 for the sign-ups in the range", async () => {
    await asServiceRole();
    const result = await rows<{ day_n: number; eligible: string; retained: string; pct: string }>(
      `select day_n, eligible::text, retained::text, pct::text
       from public.metric_retention($1::date, $1::date, '${TZ}', false, '{}')`,
      [day(-40)],
    );
    const byDay = Object.fromEntries(result.map((r) => [r.day_n, r]));
    // Alice, Bob and Carol signed up on day -40 (owner and demo are internal).
    expect(byDay[7]).toMatchObject({ eligible: "3", retained: "1" });
    expect(Number(byDay[7].pct)).toBeCloseTo(33.3, 1);
    expect(byDay[1]).toMatchObject({ eligible: "3", retained: "1" });
    expect(byDay[30]).toMatchObject({ eligible: "3", retained: "0" });
  });

  it("builds the cohort table from the sign-up week", async () => {
    await asServiceRole();
    const cohorts = await rows<{ week: number; cohort_size: string; active_users: string }>(
      `select week, cohort_size::text, active_users::text
       from public.metric_cohorts($1::date, $1::date, 12, '${TZ}', false, '{}')`,
      [day(-40)],
    );
    expect(cohorts[0]).toMatchObject({ week: 0, cohort_size: "3" });
    expect(Number(cohorts[0].active_users)).toBeGreaterThanOrEqual(1);
    expect(cohorts.length).toBeGreaterThanOrEqual(6);
  });

  it("places actions in the weekday × hour heatmap", async () => {
    await asServiceRole();
    const cells = await rows<{ hour: number; events: string }>(
      `select hour, events::text from public.metric_usage_heatmap($1::date, $2::date, '${TZ}', false, '{}')`,
      [day(-40), day(0)],
    );
    expect(cells.every((c) => c.hour === 10)).toBe(true);
    expect(cells.reduce((sum, c) => sum + Number(c.events), 0)).toBe(6);
  });
});

describe("activation funnel", () => {
  it("counts each step only after the ones before it, with medians between steps", async () => {
    await asServiceRole();
    const steps = await rows<{
      step_key: string;
      users: string;
      pct_of_start: string;
      median_hours_from_previous: string | null;
    }>(
      `select step_key, users::text, pct_of_start::text, median_hours_from_previous::text
       from public.metric_funnel($1::date, $1::date, '${TZ}', false, '{}')`,
      [day(-40)],
    );
    const by = Object.fromEntries(steps.map((s) => [s.step_key, s]));
    expect(steps.map((s) => s.step_key)).toEqual([
      "registered",
      "onboarding_completed",
      "first_milestone",
      "first_task_completed",
      "first_contact",
      "first_deal",
      "first_meeting",
      "first_won_deal",
    ]);
    expect(by.registered.users).toBe("3");
    expect(by.onboarding_completed.users).toBe("2");
    expect(Number(by.onboarding_completed.median_hours_from_previous)).toBe(1);
    expect(by.first_milestone.users).toBe("2");
    expect(by.first_task_completed.users).toBe("1");
    expect(by.first_contact.users).toBe("1");
    expect(by.first_deal.users).toBe("1");
    // Alice never booked a meeting, so the won deal step stays empty too.
    expect(by.first_meeting.users).toBe("0");
    expect(by.first_won_deal.users).toBe("0");
    expect(Number(by.first_deal.pct_of_start)).toBeCloseTo(33.3, 1);
    // Task completed at day -33 10:00, milestone at -40 10:00: 7 days.
    expect(Number(by.first_task_completed.median_hours_from_previous)).toBe(168);
  });
});

describe("costs", () => {
  it("gives the cost per active user from AI, Places and e-mails", async () => {
    await asServer();
    await db.query(
      `insert into ai_usage (user_id, purpose, model, cost_usd, created_at) values
         ($1, 'chat', 'claude-sonnet', 0.30, ($3::timestamp at time zone '${TZ}')),
         ($2, 'chat', 'claude-haiku', 0.10, ($3::timestamp at time zone '${TZ}')),
         ($4, 'chat', 'claude-opus', 5.00, ($3::timestamp at time zone '${TZ}'))`,
      [alice, carol, at(-5), demo],
    );
    for (let i = 0; i < 10; i++) {
      await track(alice, "places_request", -5, { ok: true, saved: 20 });
    }
    await track(bob, "email_sent", -5, { attachments: 0, used_ai_draft: false, from_deal: false });

    await asServiceRole();
    const plans = await rows<{
      plan: string;
      users: string;
      active_users: string;
      ai_cost_usd: string;
      places_requests: string;
      emails_sent: string;
    }>(
      `select plan, users::text, active_users::text, ai_cost_usd::text,
              places_requests::text, emails_sent::text
       from public.metric_cost_inputs($1::date, $2::date, '${TZ}', false, '{}')`,
      [day(-10), day(0)],
    );
    expect(plans).toHaveLength(1);
    const [trial] = plans;
    expect(trial.plan).toBe("trial");
    // Alice and Bob were active; Carol's AI cost counts, the demo account's does not.
    expect(trial.active_users).toBe("2");
    expect(Number(trial.ai_cost_usd)).toBeCloseTo(0.4, 6);
    expect(trial.places_requests).toBe("10");
    expect(trial.emails_sent).toBe("1");

    const inputs: CostInputs = {
      activeUsers: Number(trial.active_users),
      aiCostUsd: Number(trial.ai_cost_usd),
      placesRequests: Number(trial.places_requests),
      emailsSent: Number(trial.emails_sent),
    };
    const rates = { placesUsdPer1000: 35, emailUsd: 0.001, usdCzk: 20 };
    const perUser = costPerActiveUser(inputs, rates)!;
    // (0.40 + 10 × 0.035 + 1 × 0.001) / 2 = 0.3755 USD
    expect(perUser.usd).toBeCloseTo(0.3755, 6);
    expect(perUser.czk).toBeCloseTo(7.51, 6);
    expect(costPerActiveUser({ ...inputs, activeUsers: 0 }, rates)).toBeNull();
  });

  it("splits AI calls by feature and model", async () => {
    await asServiceRole();
    const byModel = await rows<{ key: string; calls: string }>(
      `select key, calls::text from public.metric_ai_usage($1::date, $2::date, 'model', '${TZ}', true, '{}')`,
      [day(-10), day(0)],
    );
    expect(byModel.map((r) => r.key)).toEqual(["claude-haiku", "claude-opus", "claude-sonnet"]);
  });
});

describe("money", () => {
  it("never adds amounts of different currencies together", async () => {
    await asServer();
    const stage = await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and is_won limit 1`,
      [alice],
    );
    await db.query(
      `insert into deals (user_id, stage_id, title, value, currency, won_at, created_at) values
         ($1, $2, 'A', 1000, 'CZK', ($3::timestamp at time zone '${TZ}'), ($3::timestamp at time zone '${TZ}')),
         ($1, $2, 'B', 3000, 'CZK', ($3::timestamp at time zone '${TZ}'), ($3::timestamp at time zone '${TZ}')),
         ($1, $2, 'C', 100, 'EUR', ($3::timestamp at time zone '${TZ}'), ($3::timestamp at time zone '${TZ}'))`,
      [alice, stage.id, at(-3)],
    );
    await db.query(
      `insert into transactions (user_id, type, amount, currency, occurred_on) values
         ($1, 'income', 500, 'CZK', $2::date),
         ($1, 'income', 20, 'EUR', $2::date)`,
      [alice, day(-3)],
    );
    await asServiceRole();
    const money = await rows<{ metric: string; currency: string; items: string; total: string }>(
      `select metric, currency, items::text, total::text
       from public.metric_money_by_currency($1::date, $2::date, '${TZ}', false, '{}')`,
      [day(-10), day(0)],
    );
    const won = money.filter((m) => m.metric === "deals_won");
    expect(won.map((m) => [m.currency, m.items, Number(m.total)])).toEqual([
      ["CZK", "2", 4000],
      ["EUR", "1", 100],
    ]);
    const income = money.filter((m) => m.metric === "income");
    // Won deals book their income too (4000 CZK, 100 EUR), still per currency.
    expect(income.map((m) => [m.currency, Number(m.total)])).toEqual([
      ["CZK", 4500],
      ["EUR", 120],
    ]);
  });
});

describe("events and features", () => {
  it("counts, splits and adopts by section", async () => {
    await asServiceRole();
    const users = await rows<{ value: string }>(
      `select value::text from public.metric_event_series('milestone_created', 'users', $1::date, $2::date, 'month', null, '{}', '${TZ}', false, '{}')`,
      [day(-40), day(0)],
    );
    expect(users.reduce((sum, r) => sum + Number(r.value), 0)).toBe(2);

    const reward = await rows<{ key: string; value: string }>(
      `select key, value::text from public.metric_event_breakdown('milestone_created', 'has_reward', 'count', $1::date, $2::date)`,
      [day(-40), day(0)],
    );
    expect(reward).toEqual([
      { key: "false", value: "1" },
      { key: "true", value: "1" },
    ]);

    const adoption = await rows<{ section: string; users: string }>(
      `select section, users::text from public.metric_adoption($1::date, $2::date)`,
      [day(-40), day(0)],
    );
    expect(adoption.find((a) => a.section === "milestones")?.users).toBe("2");

    await expect(
      db.query(
        `select * from public.metric_event_series('no_such_event', 'count', $1::date, $1::date)`,
        [day(0)],
      ),
    ).rejects.toThrow(/unknown event/);
    await expect(
      db.query(
        `select * from public.metric_event_breakdown('milestone_created', 'x; drop', 'count', $1::date, $1::date)`,
        [day(0)],
      ),
    ).rejects.toThrow(/bad metric property/);
  });

  it("computes activation for sign-ups whose first week is over", async () => {
    await asServiceRole();
    const result = await one<{ signups: string; eligible: string; activated: string }>(
      `select signups::text, eligible::text, activated::text from public.metric_activation($1::date, $1::date)`,
      [day(-40)],
    );
    // Nobody was active on 3 different days within their first week.
    expect(result).toEqual({ signups: "3", eligible: "3", activated: "0" });
  });
});

describe("every other calculation", () => {
  it("runs without errors on real tables", async () => {
    await asServer();
    await db.query(
      `insert into app_sessions (user_id, started_at, last_seen_at, device, browser) values
         ($1, now() - interval '50 minutes', now() - interval '20 minutes', 'mobile', 'safari')`,
      [alice],
    );
    await db.query(
      `insert into analytics_events (event, props) values
         ('cron_run', '{"job":"metrics_daily","ok":true,"duration_ms":120}'),
         ('server_call', '{"name":"jarvis","kind":"route","ok":false,"duration_ms":900,"status":500}')`,
    );
    await asServiceRole();
    const range = [day(-40), day(0)];
    for (const kind of [
      "plan",
      "mode",
      "industry",
      "locale",
      "country",
      "role",
      "signup_week",
      "currency",
      "theme",
      "jarvis_frequency",
      "animations",
      "sounds",
      "jarvis_proactive",
      "device",
      "browser",
      "level",
      "streak",
      "achievement",
      "chapter_completed",
      "unlock_days",
      "fakturoid_connected",
      "workers_per_owner",
      "feature_request_status",
    ]) {
      await db.query(`select * from public.metric_distribution($1)`, [kind]);
    }
    const plans = await rows<{ key: string; users: string }>(
      `select key, users::text from public.metric_distribution('plan')`,
    );
    expect(plans).toEqual([{ key: "trial", users: "3" }]);

    const sessions = await one<{ sessions: string; median_minutes: string }>(
      `select sessions::text, median_minutes::text from public.metric_sessions($1::date, $2::date)`,
      range,
    );
    expect(sessions.sessions).toBe("1");
    expect(Number(sessions.median_minutes)).toBe(30);

    const activeDays = await rows<{ days: number; user_weeks: string }>(
      `select days, user_weeks::text from public.metric_active_days($1::date, $2::date)`,
      range,
    );
    expect(activeDays.every((d) => d.days >= 1 && d.days <= 7)).toBe(true);

    const latency = await rows<{ key: string; p50: string }>(
      `select key, p50::text from public.metric_event_percentiles('server_call', 'duration_ms', $1::date, $2::date, 'name')`,
      range,
    );
    expect(latency).toEqual([{ key: "jarvis", p50: "900.00" }]);

    const crons = await rows<{ job: string; last_ok: boolean }>(
      `select job, last_ok from public.metric_cron_runs()`,
    );
    expect(crons).toContainEqual({ job: "metrics_daily", last_ok: true });

    await asServer();
    await db.query(
      `insert into prospecting_segments (user_id, actor_id, started_at, ended_at, end_reason) values
         ($1, $1, ($2::timestamp at time zone '${TZ}'), ($2::timestamp at time zone '${TZ}') + interval '90 minutes', 'pause')`,
      [bob, at(-3)],
    );
    await track(bob, "contact_moved", -3, {
      from_table: "unreached",
      to_table: "meeting_scheduled",
      questions: 0,
      meeting_booked: true,
    });
    await db.query(`select public.count_generation_keyword('pekarna')`);
    await asServiceRole();
    const calls = await one<{ hours: string; meetings: string; meetings_per_hour: string }>(
      `select hours::text, meetings::text, meetings_per_hour::text from public.metric_call_time($1::date, $2::date)`,
      range,
    );
    expect(calls).toEqual({ hours: "1.50", meetings: "1", meetings_per_hour: "0.67" });
    const keywords = await rows<{ keyword: string }>(
      `select keyword from public.metric_generation_keywords($1::date, $2::date)`,
      range,
    );
    expect(keywords).toEqual([{ keyword: "pekarna" }]);
    await db.query(`select * from public.metric_trials()`);
    await db.query(`select * from public.metric_waitlist($1::date, $2::date)`, range);
    await db.query(`select * from public.metric_workers($1::date, $2::date)`, range);
    await db.query(`select * from public.metric_jarvis_conversations($1::date, $2::date)`, range);
    const top = await rows<{ user_id: string }>(
      `select user_id from public.metric_ai_top_users($1::date, $2::date, 10, '${TZ}', true)`,
      range,
    );
    expect(top[0].user_id).toBe(demo);
  });
});

describe("the registry against the database", () => {
  it("computes every metric with the arguments its function expects", async () => {
    await asServiceRole();
    const params = { from: day(-40), to: day(0), segment: { plan: "trial", device: "desktop" } };
    for (const definition of METRICS) {
      const results: Row[][] = [];
      for (const call of planMetric(definition, params)) {
        const names = Object.keys(call.args);
        const values = names.map((name) => {
          const value = call.args[name];
          return value !== null && typeof value === "object" && !Array.isArray(value)
            ? JSON.stringify(value)
            : value;
        });
        const sql = `select * from public.${call.fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(", ")})`;
        try {
          results.push(await rows(sql, values));
        } catch (error) {
          throw new Error(`${definition.key}: ${(error as Error).message}`);
        }
      }
      expect(() => combineMetric(definition, params, results)).not.toThrow();
    }
  });
});

describe("daily summaries", () => {
  it("stores finished days and reads them back; today stays live", async () => {
    await asServiceRole();
    const written = await one<{ n: number }>(`select public.refresh_metrics_daily($1::date) as n`, [
      day(-2),
    ]);
    expect(written.n).toBeGreaterThan(0);
    await expect(
      db.query(`select public.refresh_metrics_daily($1::date)`, [day(0)]),
    ).rejects.toThrow(/finished days/);

    await asServer();
    const stored = await one<{ value: string }>(
      `select value::text from metrics_daily where metric_key = 'dau' and segment = '{}' and date = $1::date`,
      [day(-2)],
    );
    expect(stored.value).toBe("2");
    // A tampered stored value shows that reads come from the summary table.
    await db.query(
      `update metrics_daily set value = 99 where metric_key = 'dau' and segment = '{}' and date = $1::date`,
      [day(-2)],
    );
    const value = await series(["dau"], day(-2), day(0));
    expect(value("dau", day(-2))).toBe(99);
    expect(value("dau", day(0))).toBe(0);
    await asServer();
    await db.query(`select 1`);
    await asServiceRole();
    await db.query(`select public.refresh_metrics_daily($1::date)`, [day(-2)]);
    const fixed = await series(["dau"], day(-2), day(-2));
    expect(fixed("dau", day(-2))).toBe(2);

    // Segments of their own are stored too.
    await asServer();
    const segments = await rows<{ segment: Row }>(
      `select distinct segment from metrics_daily where metric_key = 'dau' and date = $1::date`,
      [day(-2)],
    );
    expect(segments.map((s) => s.segment)).toContainEqual({ internal: true });
    expect(segments.map((s) => s.segment)).toContainEqual({ plan: "trial" });
  });

  it("reads a year of a dozen metrics from the summaries quickly", async () => {
    await asServer();
    await db.query(
      `insert into metrics_daily (date, metric_key, segment, value)
       select d::date, k.metric_key, '{}', 1
       from generate_series($1::date, $2::date, interval '1 day') d
       cross join metric_daily_keys() k
       on conflict do nothing`,
      [day(-365), day(-1)],
    );
    const started = performance.now();
    const value = await series(
      [
        "signups",
        "dau",
        "wau",
        "mau",
        "stickiness",
        "ai_cost_usd",
        "places_requests",
        "emails_sent",
      ],
      day(-365),
      day(0),
    );
    const elapsed = performance.now() - started;
    expect(value("signups", day(-200))).toBe(1);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("access", () => {
  it("keeps metrics away from signed-in users", async () => {
    await asUser(alice);
    await expect(db.query(`select 1 from metrics_daily limit 1`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query(`select 1 from analytics_event_catalog limit 1`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query(`select * from public.metric_series(array['dau'], current_date, current_date)`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`select * from public.metric_funnel(current_date, current_date)`),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query(`select public.refresh_metrics_daily(current_date - 1)`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query(`select * from public.metric_waitlist(current_date, current_date)`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        `insert into metrics_daily (date, metric_key, value) values (current_date, 'dau', 1)`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("lists no metric function a signed-in user may run", async () => {
    await asServer();
    const callable = await rows<{ name: string }>(
      `select p.proname as name
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and (p.proname like 'metric\\_%' or p.proname in ('refresh_metrics_daily', 'metrics_timezone'))
         and (has_function_privilege('authenticated', p.oid, 'execute')
              or has_function_privilege('anon', p.oid, 'execute'))`,
    );
    expect(callable).toEqual([]);
  });
});
