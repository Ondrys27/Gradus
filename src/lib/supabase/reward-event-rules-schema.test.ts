// @vitest-environment node
//
// Reward rules with any trigger (29.1) on the real migrations (PGlite):
//   * before / after: plans of 28.2 pay the same for the same events once
//     their rules are converted (one worker before the migration, a twin
//     with the same plan after it), and what a contact already paid stays
//     paid once,
//   * the new engine: any move into "Meeting scheduled" only the first time
//     (moving back cancels, moving again pays once), tiers, a bonus, "only
//     the highest", who did it, a new contact with a phone, a call,
//   * the checks of a definition, who may write and read what,
//   * "Try it": reward_history() run through simulate() pays what the
//     database paid.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newDefinition, type RuleDefinition } from "@/features/workers/rewards/definition";
import { simulate, type EventSubject } from "@/features/workers/rewards/evaluate";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const TARGET = "20261205090000_reward_event_rules.sql";

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
let owner: string;
let stranger: string;
let tables: Record<string, string>;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function as<T>(uid: string, run: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try {
    return await run();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
async function asService<T>(run: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
  try {
    return await run();
  } finally {
    await db.exec(`reset role;`);
  }
}
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}
async function hire(account: string, actions: Record<string, string[]> = {}) {
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'W', 'active') returning id`,
    [owner, account],
  );
  await as(owner, () =>
    db.query(
      `insert into worker_permission_grants (owner_id, worker_id, section, action, allowed)
       select $1, $2, c.section, c.action, coalesce((($3::jsonb) -> c.section) ? c.action, false)
       from permission_catalog() c
       on conflict (worker_id, section, action) do update set allowed = excluded.allowed`,
      [owner, id, JSON.stringify(actions)],
    ),
  );
  return id;
}
async function makePlan(worker: string) {
  return as(owner, async () =>
    (
      await one<{ id: string }>(
        `insert into reward_plans (space_id, worker_id, approval, currency) values ($1, $2, 'auto', 'CZK') returning id`,
        [owner, worker],
      )
    ).id,
  );
}
/** Rules of 28.2 (columns kind, amount, …), written by the owner. */
async function legacyRules(plan: string, worker: string, list: Array<Record<string, unknown>>) {
  await as(owner, async () => {
    for (const [index, rule] of list.entries()) {
      await db.query(
        `insert into reward_plan_rules (plan_id, space_id, worker_id, kind, amount, percent, filter, cap_per_period, position)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [plan, owner, worker, rule.kind, rule.amount ?? null, rule.percent ?? null,
          JSON.stringify(rule.filter ?? {}), rule.cap ?? null, index],
      );
    }
  });
}
/** Event rules (29.1), written by the owner. */
async function eventRules(plan: string, worker: string, list: RuleDefinition[]) {
  return as(owner, async () => {
    const ids: string[] = [];
    for (const [index, definition] of list.entries()) {
      const { id } = await one<{ id: string }>(
        `insert into reward_plan_rules (plan_id, space_id, worker_id, kind, definition, position)
         values ($1, $2, $3, 'event', $4, $5) returning id`,
        [plan, owner, worker, JSON.stringify(definition), index],
      );
      ids.push(id);
    }
    return ids;
  });
}
async function contact(name = "Pekárna", extra: Record<string, unknown> = {}) {
  return (
    await one<{ id: string }>(
      `insert into contacts (user_id, company_name, phone, email) values ($1, $2, $3, $4) returning id`,
      [owner, name, extra.phone ?? null, extra.email ?? null],
    )
  ).id;
}
/** Moves a millisecond apart: the clock of PGlite can give two statements the same now(). */
let tick = 0;
async function move(actor: string | null, contactId: string, from: string, to: string) {
  tick += 1;
  await db.query(
    `insert into contact_table_moves (user_id, actor_id, contact_id, from_table_id, to_table_id, created_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6::numeric / 1000))`,
    [owner, actor, contactId, tables[from], tables[to], tick],
  );
}
async function stage(key: string) {
  return (
    await one<{ id: string }>(`select id from pipeline_stages where user_id = $1 and system_key = $2`, [owner, key])
  ).id;
}
type Paid = { amount: string; status: string; source_kind: string; bonus: boolean };
async function paid(worker: string): Promise<Paid[]> {
  return rows<Paid>(
    `select amount::text, status, source_kind, source_kind = 'bonus' as bonus from reward_entries
     where worker_id = $1 and corrects_id is null and reversed_at is null order by occurred_at, created_at, id`,
    [worker],
  );
}
const amounts = (list: Paid[]) => list.map((entry) => entry.amount);

async function applyMigrations(filter: (file: string) => boolean) {
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    if (filter(file)) await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
}

// ---------------------------------------------------------------------------
// The same events before and after the conversion
// ---------------------------------------------------------------------------

const LEGACY_PLAN = [
  { kind: "per_call", amount: 10 },
  { kind: "per_contact", amount: 100 },
  { kind: "per_meeting", amount: 2000, cap: 3000 },
  { kind: "task_fixed", filter: { onTimeOnly: true } },
  { kind: "task_default", amount: 150 },
  { kind: "deal_percent", percent: 10, cap: 3000, filter: { minDealValue: 1000 } },
  { kind: "deal_fixed", amount: 500 },
  { kind: "project_done", amount: 1000 },
  { kind: "hourly", amount: 300 },
  { kind: "monthly_fixed", amount: 15000 },
];

/** One run of everything a worker does in a day; what each step paid. */
async function scenario(account: string, worker: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const ids = async () =>
    new Set((await rows<{ id: string }>(`select id from reward_entries where worker_id = $1`, [worker])).map((r) => r.id));
  const step = async (key: string, run: () => Promise<unknown>) => {
    const start = await ids();
    await run();
    const list = await rows<{ id: string; amount: string; status: string }>(
      `select id, amount::text, status from reward_entries where worker_id = $1 and corrects_id is null and reversed_at is null`,
      [worker],
    );
    out[key] = list.filter((entry) => !start.has(entry.id)).map((entry) => `${entry.amount}:${entry.status}`).sort();
  };

  const kavarna = await contact("Kavárna");
  const pekarna = await contact("Pekárna");
  await step("call and meeting", () => move(account, kavarna, "unreached", "meeting_scheduled"));
  await step("back and again", async () => {
    await move(account, kavarna, "meeting_scheduled", "follow_up");
    await move(account, kavarna, "follow_up", "meeting_scheduled");
  });
  await step("second meeting over the cap", () => move(account, pekarna, "no_answer", "meeting_scheduled"));
  await step("owner moves", () => move(owner, pekarna, "meeting_scheduled", "interested"));

  const task = await as(owner, async () =>
    (
      await one<{ id: string }>(
        `insert into crm_tasks (user_id, title, due_at, assignee_id, contact_id)
         values ($1, 'Nabídka', now() + interval '1 day', $2, $3) returning id`,
        [owner, account, kavarna],
      )
    ).id,
  );
  await step("priced task planned", () => as(owner, () => db.query(`select reward_set_price('crm_task', $1, 700, 'CZK')`, [task])));
  await step("priced task done", () => as(account, () => db.query(`update crm_tasks set status = 'done' where id = $1`, [task])));
  const [onTime, late] = await as(owner, async () =>
    rows<{ id: string }>(
      `insert into worker_tasks (owner_id, worker_id, title, due_date) values
         ($1, $2, 'Včas', current_date + 1), ($1, $2, 'Pozdě', current_date - 2) returning id`,
      [owner, worker],
    ),
  );
  await step("tasks done", () =>
    as(account, () => db.query(`update worker_tasks set status = 'done' where id = any($1)`, [[onTime!.id, late!.id]])),
  );

  const lead = await stage("lead");
  const won = await stage("won");
  const lost = await stage("lost");
  const [big, small] = await as(account, async () =>
    rows<{ id: string }>(
      `insert into deals (user_id, stage_id, title, value) values ($1, $2, 'Big', 25000), ($1, $2, 'Small', 500) returning id`,
      [owner, lead],
    ),
  );
  await step("deals won", async () => {
    await as(owner, () => db.query(`update deals set stage_id = $1 where id = any($2)`, [won, [big!.id, small!.id]]));
  });
  await step("deal lost after the win", () => as(owner, () => db.query(`update deals set stage_id = $1 where id = $2`, [lost, small!.id])));

  const milestone = await as(owner, async () =>
    (await one<{ id: string }>(`insert into milestones (user_id, title) values ($1, 'E-shop') returning id`, [owner])).id,
  );
  await as(owner, () => db.query(`select reward_set_price('milestone', $1, null, null, $2)`, [milestone, worker]));
  await as(owner, () =>
    db.query(`insert into tasks (user_id, milestone_id, title, status) values ($1, $2, 'Hotovo', 'done')`, [owner, milestone]),
  );
  await step("milestone", () => as(owner, () => db.query(`update milestones set status = 'completed' where id = $1`, [milestone])));

  const session = await as(account, () => one<{ id: string }>(`select * from start_work_session($1)`, [worker]));
  await db.query(`update work_sessions set started_at = now() - interval '90 minutes' where id = $1`, [session.id]);
  await step("hours", () => as(account, () => db.query(`select * from pause_work_session($1)`, [worker])));
  await step("month", () => asService(() => db.query(`select reward_run_monthly()`)));
  return out;
}

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  await applyMigrations((file) => file < TARGET);
  owner = await createAuthUser();
  stranger = await createAuthUser();
  tables = Object.fromEntries(
    (
      await rows<{ system_key: string; id: string }>(
        `select system_key, id from contact_tables where user_id = $1 and system_key is not null`,
        [owner],
      )
    ).map((row) => [row.system_key, row.id]),
  );
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("plans of 28.2 before and after the conversion", () => {
  let before: Record<string, string[]>;
  let twin: { account: string; worker: string };
  let first: { account: string; worker: string; contact: string };

  it("runs the events on the old engine", async () => {
    const account = await createAuthUser();
    const worker = await hire(account, { pipeline: ["view", "create", "update", "change_stage"], tasks: ["view", "update"] });
    await legacyRules(await makePlan(worker), worker, LEGACY_PLAN);
    const twinAccount = await createAuthUser();
    const twinWorker = await hire(twinAccount, { pipeline: ["view", "create", "update", "change_stage"], tasks: ["view", "update"] });
    await legacyRules(await makePlan(twinWorker), twinWorker, LEGACY_PLAN);
    twin = { account: twinAccount, worker: twinWorker };
    before = await scenario(account, worker);
    const firstAccount = await createAuthUser();
    const firstWorker = await hire(firstAccount);
    await legacyRules(await makePlan(firstWorker), firstWorker, [
      { kind: "per_contact", amount: 100 },
      { kind: "per_meeting", amount: 2000 },
    ]);
    first = { account: firstAccount, worker: firstWorker, contact: await contact("Před") };
    await move(firstAccount, first.contact, "unreached", "interested");
    expect(before["call and meeting"]).toEqual(["10.00:approved", "100.00:approved", "2000.00:approved"]);
    expect(before["second meeting over the cap"]).toEqual(["10.00:approved", "100.00:approved", "1000.00:approved"]);
  });

  it("converts every rule and keeps the entries", async () => {
    const count = (await one<{ n: number }>(`select count(*)::int as n from reward_entries`)).n;
    await applyMigrations((file) => file >= TARGET);
    expect((await one<{ n: number }>(`select count(*)::int as n from reward_entries`)).n).toBe(count);
    expect(await rows(`select distinct kind from reward_plan_rules`)).toEqual([{ kind: "event" }]);
    expect(
      await rows(`select count(*)::int as n from reward_entries where rule_id is not null and rule_kind <> 'event'`),
    ).toEqual([{ n: 0 }]);
  });

  it("pays the same for the same events after it", async () => {
    const after = await scenario(twin.account, twin.worker);
    // The cron made the month of both workers on the first run; after it nothing doubles.
    expect(before.month).toEqual(["15000.00:planned"]);
    expect(after.month).toEqual([]);
    expect(
      await rows(`select amount::text, status from reward_entries where worker_id = $1 and source_kind = 'month'`, [twin.worker]),
    ).toEqual([{ amount: "15000.00", status: "planned" }]);
    const withoutMonth = (steps: Record<string, string[]>) =>
      Object.fromEntries(Object.entries(steps).filter(([key]) => key !== "month"));
    expect(withoutMonth(after)).toEqual(withoutMonth(before));
  });

  it("does not pay twice what a contact paid before the conversion", async () => {
    const start = (await paid(first.worker)).length;
    await move(first.account, first.contact, "interested", "meeting_scheduled");
    // The meeting is new; the qualified contact was paid before (only the first time).
    expect(amounts((await paid(first.worker)).slice(start))).toEqual(["2000.00"]);
  });
});

// ---------------------------------------------------------------------------
// The new engine
// ---------------------------------------------------------------------------

function anyToMeeting(amount: number): RuleDefinition {
  const definition = newDefinition("contact.moved", amount);
  definition.event.to = { mode: "only", ids: [tables.meeting_scheduled!] };
  return definition;
}

describe("rules with any trigger", () => {
  it("any move into Meeting scheduled pays once; back and again does not pay twice", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    await eventRules(await makePlan(worker), worker, [anyToMeeting(500)]);
    const c = await contact();
    await move(account, c, "follow_up", "meeting_scheduled");
    expect(amounts(await paid(worker))).toEqual(["500.00"]);
    // Back out: the unpaid reward is cancelled; in again: one reward.
    await move(account, c, "meeting_scheduled", "follow_up");
    expect(await paid(worker)).toEqual([]);
    await move(account, c, "follow_up", "meeting_scheduled");
    await move(account, c, "meeting_scheduled", "meeting_scheduled");
    expect(amounts(await paid(worker))).toEqual(["500.00"]);
  });

  it("a paid reward stays when the contact moves back, and is not paid again", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    await eventRules(await makePlan(worker), worker, [anyToMeeting(400)]);
    const c = await contact();
    await move(account, c, "unreached", "meeting_scheduled");
    const [entry] = await rows<{ id: string }>(`select id from reward_entries where worker_id = $1`, [worker]);
    await as(owner, () => db.query(`select reward_payout_create($1, $2, current_date, null, 'Odměny')`, [worker, [entry!.id]]));
    await move(account, c, "meeting_scheduled", "follow_up");
    await move(account, c, "follow_up", "meeting_scheduled");
    expect((await paid(worker)).map((e) => `${e.amount}:${e.status}`)).toEqual(["400.00:paid"]);
  });

  it("tiers by the month's count, a bonus at a count, taken back with a move back", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    const definition = anyToMeeting(0);
    definition.reward = { type: "tiers", tiers: [{ from: 1, amount: 100 }, { from: 3, amount: 300 }] };
    definition.limits = { bonus: { count: 3, amount: 5000 } };
    await eventRules(await makePlan(worker), worker, [definition]);
    const contacts = [await contact("A"), await contact("B"), await contact("C")];
    for (const c of contacts) await move(account, c, "unreached", "meeting_scheduled");
    expect((await paid(worker)).map((e) => `${e.amount}:${e.bonus}`).sort()).toEqual([
      "100.00:false",
      "100.00:false",
      "300.00:false",
      "5000.00:true",
    ]);
    await move(account, contacts[2]!, "meeting_scheduled", "failed");
    expect((await paid(worker)).map((e) => `${e.amount}:${e.bonus}`)).toEqual(["100.00:false", "100.00:false"]);
  });

  it("a rule switched off keeps the bonus it earned while the count holds", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    const definition = anyToMeeting(100);
    definition.limits = { bonus: { count: 2, amount: 5000 } };
    const plan = await makePlan(worker);
    await eventRules(plan, worker, [definition]);
    const contacts = [await contact("A"), await contact("B"), await contact("C")];
    for (const c of contacts) await move(account, c, "unreached", "meeting_scheduled");
    await as(owner, () => db.query(`update reward_plan_rules set active = false where plan_id = $1`, [plan]));
    // One reward undone, two still stand: the bonus at two stays.
    await move(account, contacts[2]!, "meeting_scheduled", "failed");
    expect((await paid(worker)).map((e) => `${e.amount}:${e.bonus}`).sort()).toEqual([
      "100.00:false",
      "100.00:false",
      "5000.00:true",
    ]);
    // Under the count: the unpaid bonus goes.
    await move(account, contacts[1]!, "meeting_scheduled", "failed");
    expect((await paid(worker)).map((e) => `${e.amount}:${e.bonus}`)).toEqual(["100.00:false"]);
  });

  it("two rules on one event: both add up, or only the highest pays", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    const low = { ...anyToMeeting(500), stack: "max" as const };
    const high = { ...anyToMeeting(800), stack: "max" as const };
    const plan = await makePlan(worker);
    await eventRules(plan, worker, [low, high]);
    await move(account, await contact(), "unreached", "meeting_scheduled");
    expect(amounts(await paid(worker))).toEqual(["800.00"]);
    await as(owner, () => db.query(`update reward_plan_rules set definition = jsonb_set(definition, '{stack}', '"sum"') where plan_id = $1`, [plan]));
    await move(account, await contact(), "unreached", "meeting_scheduled");
    expect(amounts(await paid(worker)).sort()).toEqual(["500.00", "800.00", "800.00"]);
  });

  it("a deal moved between stages: by the worker, or on their deal", async () => {
    const account = await createAuthUser();
    const worker = await hire(account, { pipeline: ["view", "create", "update", "change_stage"] });
    const lead = await stage("lead");
    const meeting = await stage("meeting");
    const self = newDefinition("deal.moved", 200);
    self.event.to = { mode: "only", ids: [meeting] };
    const record = { ...newDefinition("deal.moved", 50), conditions: { who: "record" as const, once: true } };
    record.event.to = { mode: "only", ids: [meeting] };
    await eventRules(await makePlan(worker), worker, [self, record]);
    const [mine, owners] = await as(account, async () =>
      rows<{ id: string }>(
        `insert into deals (user_id, stage_id, title, value) values ($1, $2, 'Mine', 1000), ($1, $2, 'Other', 1000) returning id`,
        [owner, lead],
      ),
    );
    await as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [owners!.id, [owner]]));
    await as(account, () => db.query(`update deals set stage_id = $1 where id = $2`, [meeting, mine!.id]));
    // Moved by the owner, but the worker made the deal: only "on their record" pays.
    await as(owner, () => db.query(`update deals set stage_id = $1 where id = $2`, [meeting, owners!.id]));
    expect(amounts(await paid(worker)).sort()).toEqual(["200.00", "50.00", "50.00"]);
  });

  it("a new contact pays once it has a phone; a call written to a contact", async () => {
    const account = await createAuthUser();
    const worker = await hire(account, { contacts: ["view", "create", "update"] });
    const created = newDefinition("contact.created", 30);
    created.event.require = "phone";
    await eventRules(await makePlan(worker), worker, [created, newDefinition("call.logged", 5)]);
    const c = await as(account, async () =>
      (await one<{ id: string }>(`insert into contacts (user_id, company_name, created_by) values ($1, 'Bez telefonu', $2) returning id`, [owner, owner])).id,
    );
    // The client cannot name somebody else as the maker.
    expect((await one<{ created_by: string }>(`select created_by from contacts where id = $1`, [c])).created_by).toBe(account);
    expect(await paid(worker)).toEqual([]);
    await as(account, () => db.query(`update contacts set phone = '+420777123456' where id = $1`, [c]));
    await as(account, () =>
      db.query(`insert into contact_activities (user_id, contact_id, type, content) values ($1, $2, 'call', 'x')`, [owner, c]),
    );
    expect(amounts(await paid(worker)).sort()).toEqual(["30.00", "5.00"]);
  });
});

describe("who writes and reads rules", () => {
  it("the database refuses a broken rule, the worker writes none, only managers try one", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    const plan = await makePlan(worker);
    const broken = [
      { ...anyToMeeting(-5) },
      { ...anyToMeeting(5), extra: true },
      { ...newDefinition("time.month", 100), limits: { cap: 50 } },
      { ...newDefinition("deal.won", 100), reward: { type: "price" } },
      { ...anyToMeeting(0), reward: { type: "tiers", tiers: [{ from: 2, amount: 10 }, { from: 3, amount: 20 }] } },
    ];
    for (const definition of broken) {
      await expect(eventRules(plan, worker, [definition as RuleDefinition])).rejects.toThrow();
    }
    await as(account, async () => {
      await expect(
        db.query(
          `insert into reward_plan_rules (plan_id, space_id, worker_id, kind, definition) values ($1, $2, $3, 'event', $4)`,
          [plan, owner, worker, JSON.stringify(anyToMeeting(9999))],
        ),
      ).rejects.toThrow();
      // The worker reads the names of their rules' tables, never the history.
      const refs = await one<{ refs: { tables: unknown[] } }>(`select reward_plan_refs($1) as refs`, [worker]);
      expect(refs.refs.tables.length).toBeGreaterThan(0);
      await expect(db.query(`select reward_history($1)`, [worker])).rejects.toThrow(/reward_forbidden/);
    });
    await as(stranger, async () => {
      await expect(db.query(`select reward_plan_refs($1)`, [worker])).rejects.toThrow(/reward_forbidden/);
      await expect(db.query(`select reward_history($1)`, [worker])).rejects.toThrow(/reward_forbidden/);
    });
  });
});

describe("Try it", () => {
  it("the worker's history run through the rule pays what the database paid", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    const definition = anyToMeeting(250);
    definition.limits = { cap: 600 };
    const plan = await makePlan(worker);
    await eventRules(plan, worker, [definition]);
    const list = [await contact("A"), await contact("B"), await contact("C")];
    await move(account, list[0]!, "unreached", "meeting_scheduled");
    await move(account, list[0]!, "meeting_scheduled", "follow_up");
    await move(account, list[0]!, "follow_up", "meeting_scheduled");
    await move(account, list[1]!, "no_answer", "meeting_scheduled");
    await move(account, list[2]!, "unreached", "meeting_scheduled");
    const live = await paid(worker);
    const history = await as(owner, async () =>
      (await one<{ h: EventSubject[] }>(`select reward_history($1, 30) as h`, [worker])).h,
    );
    const zone = (await one<{ z: string }>(`select reward_zone($1) as z`, [owner])).z;
    const result = simulate(definition, history, { planCurrency: "CZK", timeZone: zone });
    expect(result.count).toBe(live.length);
    expect(result.totals).toEqual([{ currency: "CZK", amount: 600 }]);
    expect(amounts(live)).toEqual(["250.00", "250.00", "100.00"]);
    expect(result.first.map((entry) => entry.amount)).toEqual([250, 250, 100]);
    expect(result.first[0]?.note).toBe("A");
  });
});
