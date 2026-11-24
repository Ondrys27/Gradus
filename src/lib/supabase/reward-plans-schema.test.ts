// @vitest-environment node
//
// Reward plans (28.2) on the real migrations (PGlite): who manages a plan,
// prices on tasks, entries made by the database from events (planned →
// pending/approved, undone, corrected when paid, capped per month), the
// monthly fixed amount from the cron, payouts into Finance and the old drawn
// rules converted into plans.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");

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
type Entry = {
  source_kind: string;
  rule_kind: string;
  amount: string;
  currency: string;
  status: string;
  corrects: boolean;
};

let db: PGlite;
let owner: string;
let stranger: string;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function as<T>(uid: string, run: () => Promise<T>): Promise<T> {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
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
async function hire(account: string, actions: Record<string, string[]> = {}, name = "W") {
  const { id } = await one<{ id: string }>(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, $3, 'active') returning id`,
    [owner, account, name],
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
/** A plan with rules, made by the owner through row level security. */
async function plan(
  worker: string,
  rules: Array<Record<string, unknown>>,
  approval: "auto" | "manual" = "manual",
) {
  return as(owner, async () => {
    const { id } = await one<{ id: string }>(
      `insert into reward_plans (space_id, worker_id, name, approval, currency)
       values ($1, $2, 'Plán', $3, 'CZK') returning id`,
      [owner, worker, approval],
    );
    for (const [index, rule] of rules.entries()) {
      await db.query(
        `insert into reward_plan_rules (plan_id, space_id, worker_id, kind, amount, percent, filter, cap_per_period, position)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          owner,
          worker,
          rule.kind,
          rule.amount ?? null,
          rule.percent ?? null,
          JSON.stringify(rule.filter ?? {}),
          rule.cap ?? null,
          index,
        ],
      );
    }
    return id;
  });
}
async function entries(worker: string, sourceId?: string): Promise<Entry[]> {
  return rows<Entry>(
    // An entry of a rule (29.1: every rule is an event rule) is labelled by its event.
    `select e.source_kind,
            case when e.rule_kind = 'event' then coalesce(r.definition -> 'event' ->> 'key', 'event') else e.rule_kind end as rule_kind,
            e.amount::text, e.currency, e.status, e.corrects_id is not null as corrects
     from reward_entries e left join reward_plan_rules r on r.id = e.rule_id
     where e.worker_id = $1 and ($2::uuid is null or e.source_id = $2::uuid)
     order by e.created_at, e.amount`,
    [worker, sourceId ?? null],
  );
}
async function stage(key: string) {
  return (
    await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 and system_key = $2`,
      [owner, key],
    )
  ).id;
}
async function crmTask(assignee: string, title = "Zavolat", dueInHours = 24) {
  const contact = (
    await one<{ id: string }>(
      `insert into contacts (user_id, company_name) values ($1, 'Pekárna') returning id`,
      [owner],
    )
  ).id;
  return as(owner, async () =>
    (
      await one<{ id: string }>(
        `insert into crm_tasks (user_id, title, due_at, assignee_id, contact_id)
         values ($1, $2, now() + make_interval(hours => $3), $4, $5) returning id`,
        [owner, title, dueInHours, assignee, contact],
      )
    ).id,
  );
}

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser();
  stranger = await createAuthUser();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("who manages a plan", () => {
  it("the owner, and a worker with company: rewards for others, never for themself", async () => {
    const accounts = await Promise.all([createAuthUser(), createAuthUser(), createAuthUser()]);
    const [caller, managerAccount, bossAccount] = accounts;
    const callerWorker = await hire(caller);
    const manager = await hire(managerAccount, { company: ["view", "view_all", "rewards"] });
    // Sees everyone in Company, but has no right to rewards.
    const boss = await hire(bossAccount, { company: ["view", "view_all", "update"] });
    const callerPlan = await plan(callerWorker, [{ kind: "per_call", amount: 20 }]);

    // The worker reads their own plan and rules, changes nothing.
    await as(caller, async () => {
      expect(await rows(`select id from reward_plans`)).toEqual([{ id: callerPlan }]);
      // An old kind written by a client becomes an event rule (29.1).
      expect(await rows(`select kind, definition -> 'event' ->> 'key' as event from reward_plan_rules`)).toEqual([
        { kind: "event", event: "contact.moved" },
      ]);
      const changed = await db.query(`update reward_plans set approval = 'auto'`);
      expect(changed.affectedRows).toBe(0);
      await expect(
        db.query(
          `insert into reward_plan_rules (plan_id, space_id, worker_id, kind, amount) values ($1, $2, $3, 'per_call', 999)`,
          [callerPlan, owner, callerWorker],
        ),
      ).rejects.toThrow();
    });

    // The manager manages the caller's plan, not their own.
    await as(managerAccount, async () => {
      expect(await rows(`select id from reward_plans`)).toEqual([{ id: callerPlan }]);
      await db.query(`update reward_plans set approval = 'auto' where id = $1`, [callerPlan]);
      await expect(
        db.query(
          `insert into reward_plans (space_id, worker_id, currency) values ($1, $2, 'CZK')`,
          [owner, manager],
        ),
      ).rejects.toThrow();
    });
    expect((await one<{ approval: string }>(`select approval from reward_plans where id = $1`, [callerPlan])).approval).toBe("auto");

    // A boss without the right sees nothing; a stranger neither.
    for (const account of [bossAccount, stranger]) {
      await as(account, async () => {
        expect(await rows(`select id from reward_plans`)).toEqual([]);
        expect(await rows(`select id from reward_entries`)).toEqual([]);
      });
    }
    expect(boss).toBeTruthy();
  });

  it("nobody writes entries directly", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    for (const who of [owner, account]) {
      await as(who, async () => {
        await expect(
          db.query(
            `insert into reward_entries (space_id, worker_id, source_kind, rule_kind, amount, currency)
             values ($1, $2, 'manual', 'manual', 100, 'CZK')`,
            [owner, worker],
          ),
        ).rejects.toThrow();
      });
    }
  });
});

describe("prices on tasks", () => {
  it("a priced task is planned, earned when done, planned again when reopened", async () => {
    const account = await createAuthUser();
    const worker = await hire(account, { tasks: ["view", "update"] });
    await plan(worker, [{ kind: "task_fixed" }]);
    const task = await crmTask(account);

    // A client write of the price is ignored; the worker may not price their own task.
    await as(owner, () => db.query(`update crm_tasks set reward_amount = 1, reward_currency = 'CZK' where id = $1`, [task]));
    expect(await entries(worker, task)).toEqual([]);
    await as(account, async () => {
      await expect(
        db.query(`select reward_set_price('crm_task', $1, 500, 'CZK')`, [task]),
      ).rejects.toThrow(/reward_forbidden/);
    });

    await as(owner, () => db.query(`select reward_set_price('crm_task', $1, 500, 'CZK')`, [task]));
    expect(await entries(worker, task)).toEqual([
      { source_kind: "crm_task", rule_kind: "task.done", amount: "500.00", currency: "CZK", status: "planned", corrects: false },
    ]);

    await as(account, () => db.query(`update crm_tasks set status = 'done' where id = $1`, [task]));
    expect((await entries(worker, task)).map((e) => e.status)).toEqual(["pending"]);

    await as(account, () => db.query(`update crm_tasks set status = 'open' where id = $1`, [task]));
    expect((await entries(worker, task)).map((e) => e.status)).toEqual(["planned"]);

    // Done again: still one entry.
    await as(account, () => db.query(`update crm_tasks set status = 'done' where id = $1`, [task]));
    expect(await entries(worker, task)).toHaveLength(1);

    // The price taken off a done task (and no task_default): nothing is earned.
    await as(owner, () => db.query(`select reward_set_price('crm_task', $1, null, null)`, [task]));
    expect(await entries(worker, task)).toEqual([]);
  });

  it("task_default pays a done task without a price, on time only when asked", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    await plan(worker, [
      { kind: "task_default", amount: 100 },
      { kind: "task_default", amount: 50, filter: { onTimeOnly: true } },
    ]);
    const [onTime, late] = await as(owner, async () =>
      rows<{ id: string }>(
        `insert into worker_tasks (owner_id, worker_id, title, due_date) values
           ($1, $2, 'Včas', current_date + 1), ($1, $2, 'Pozdě', current_date - 2)
         returning id`,
        [owner, worker],
      ),
    );
    await as(account, async () => {
      await db.query(`update worker_tasks set status = 'done' where id = any($1)`, [
        [onTime.id, late.id],
      ]);
    });
    expect((await entries(worker, onTime.id)).map((e) => e.amount).sort()).toEqual(["100.00", "50.00"]);
    expect((await entries(worker, late.id)).map((e) => e.amount)).toEqual(["100.00"]);
  });

  it("a paid reward of a reopened task gets a negative correction", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    await plan(worker, [{ kind: "task_fixed" }], "auto");
    const task = await as(owner, async () =>
      (
        await one<{ id: string }>(
          `insert into worker_tasks (owner_id, worker_id, title) values ($1, $2, 'Web') returning id`,
          [owner, worker],
        )
      ).id,
    );
    await as(owner, () => db.query(`select reward_set_price('worker_task', $1, 2000, 'CZK')`, [task]));
    await as(account, () => db.query(`update worker_tasks set status = 'done' where id = $1`, [task]));
    const earned = await one<{ id: string; status: string }>(
      `select id, status from reward_entries where source_id = $1`,
      [task],
    );
    expect(earned.status).toBe("approved");
    await as(owner, () =>
      db.query(`select reward_payout_create($1, $2, current_date, 'Listopad', 'Odměny')`, [
        worker,
        [earned.id],
      ]),
    );
    await as(owner, () => db.query(`update worker_tasks set status = 'todo' where id = $1`, [task]));
    const sorted = (await entries(worker, task)).sort((a, b) =>
      `${a.status}${a.amount}`.localeCompare(`${b.status}${b.amount}`),
    );
    expect(sorted).toEqual([
      { source_kind: "worker_task", rule_kind: "task.done", amount: "-2000.00", currency: "CZK", status: "approved", corrects: true },
      { source_kind: "worker_task", rule_kind: "task.done", amount: "2000.00", currency: "CZK", status: "paid", corrects: false },
      { source_kind: "worker_task", rule_kind: "task.done", amount: "2000.00", currency: "CZK", status: "planned", corrects: false },
    ]);
  });
});

describe("deals, calls, meetings and hours", () => {
  it("a share of a won deal up to the monthly cap; lost after the win takes it back", async () => {
    const account = await createAuthUser();
    const worker = await hire(account, { pipeline: ["view", "create", "update", "change_stage"] });
    await plan(worker, [
      { kind: "deal_percent", percent: 10, cap: 3000, filter: { minDealValue: 1000 } },
      { kind: "deal_fixed", amount: 500 },
    ]);
    const lead = await stage("lead");
    const won = await stage("won");
    const lost = await stage("lost");
    const [big, second, small] = await as(account, async () =>
      rows<{ id: string }>(
        `insert into deals (user_id, stage_id, title, value) values
           ($1, $2, 'Big', 25000), ($1, $2, 'Second', 20000), ($1, $2, 'Small', 500)
         returning id`,
        [owner, lead],
      ),
    );
    await as(owner, () => db.query(`update deals set stage_id = $1 where id = $2`, [won, big.id]));
    await as(owner, () => db.query(`update deals set stage_id = $1 where id = $2`, [won, second.id]));
    await as(owner, () => db.query(`update deals set stage_id = $1 where id = $2`, [won, small.id]));
    const byDeal = async (id: string) =>
      (await entries(worker, id)).map((e) => `${e.rule_kind}:${e.amount}:${e.status}`).sort();
    expect(await byDeal(big.id)).toEqual(["deal.won:2500.00:pending", "deal.won:500.00:pending"]);
    // 10 % of 20 000 is 2 000, only 500 is left under the 3 000 cap.
    expect(await byDeal(second.id)).toEqual(["deal.won:500.00:pending", "deal.won:500.00:pending"]);
    // Under the minimum: no share, the fixed amount yes.
    expect(await byDeal(small.id)).toEqual(["deal.won:500.00:pending"]);

    await as(owner, () => db.query(`update deals set stage_id = $1 where id = $2`, [lost, big.id]));
    expect(await byDeal(big.id)).toEqual([]);
  });

  it("a call per move out of Not contacted, a meeting and a qualified contact once per contact", async () => {
    const account = await createAuthUser();
    const worker = await hire(account, { contacts: ["view", "update"], cold_calling: ["view", "call"] });
    await plan(worker, [
      { kind: "per_call", amount: 10 },
      { kind: "per_meeting", amount: 2000 },
      { kind: "per_contact", amount: 100 },
    ], "auto");
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Kavárna') returning id`,
        [owner],
      )
    ).id;
    const tables = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(
          `select system_key, id from contact_tables where user_id = $1 and system_key is not null`,
          [owner],
        )
      ).map((r) => [r.system_key, r.id]),
    );
    for (let i = 0; i < 2; i++) {
      await db.query(
        `insert into contact_table_moves (user_id, actor_id, contact_id, from_table_id, to_table_id)
         values ($1, $2, $3, $4, $5)`,
        [owner, account, contact, tables.unreached, tables.meeting_scheduled],
      );
    }
    const list = (await entries(worker)).map((e) => `${e.rule_kind}:${e.amount}:${e.status}`).sort();
    expect(list).toEqual([
      "contact.moved:10.00:approved",
      "contact.moved:10.00:approved",
      "contact.moved:100.00:approved",
      "meeting.booked:2000.00:approved",
    ]);
  });

  it("hours of a closed session at the hourly rate", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    await plan(worker, [{ kind: "hourly", amount: 300 }]);
    const session = await as(account, () =>
      one<{ id: string }>(`select * from start_work_session($1)`, [worker]),
    );
    await db.query(
      `update work_sessions set started_at = now() - interval '90 minutes' where id = $1`,
      [session.id],
    );
    await as(account, () => db.query(`select * from pause_work_session($1)`, [worker]));
    const [entry] = await entries(worker);
    expect(entry?.rule_kind).toBe("time.hour");
    expect(Number(entry?.amount)).toBeGreaterThan(0);
  });
});

describe("prices of deals, milestones and their tasks", () => {
  it("a deal's price is planned for the workers on it and earned when won", async () => {
    const account = await createAuthUser();
    const worker = await hire(account, { pipeline: ["view", "create", "update", "change_stage"] });
    await plan(worker, [], "auto");
    const lead = await stage("lead");
    const won = await stage("won");
    const deal = await as(owner, async () =>
      (
        await one<{ id: string }>(
          `insert into deals (user_id, stage_id, title, value) values ($1, $2, 'Web', 50000) returning id`,
          [owner, lead],
        )
      ).id,
    );
    await as(owner, () => db.query(`select deal_set_assignees($1, $2)`, [deal, [account]]));
    await as(owner, () => db.query(`select reward_set_price('deal', $1, 3000, 'CZK')`, [deal]));
    expect((await entries(worker, deal)).map((e) => `${e.rule_kind}:${e.amount}:${e.status}`)).toEqual([
      "price:3000.00:planned",
    ]);
    // Someone on the deal never prices it for themself.
    await as(account, async () => {
      await expect(
        db.query(`select reward_set_price('deal', $1, 99999, 'CZK')`, [deal]),
      ).rejects.toThrow(/reward_forbidden/);
    });
    await as(owner, () => db.query(`update deals set stage_id = $1 where id = $2`, [won, deal]));
    expect((await entries(worker, deal)).map((e) => e.status)).toEqual(["approved"]);
  });

  it("a milestone pays the worker whose project it is; its tasks whoever ticks them off", async () => {
    const account = await createAuthUser();
    const worker = await hire(account, { milestones: ["view", "update"] });
    await plan(worker, [{ kind: "project_done", amount: 10000 }]);
    const milestone = await as(owner, async () =>
      (
        await one<{ id: string }>(
          `insert into milestones (user_id, title) values ($1, 'E-shop') returning id`,
          [owner],
        )
      ).id,
    );
    const [priced, imported] = await as(owner, async () =>
      rows<{ id: string }>(
        `insert into tasks (user_id, milestone_id, title, status) values
           ($1, $2, 'Košík', 'todo'), ($1, $2, 'Hotový z importu', 'done')
         returning id`,
        [owner, milestone],
      ),
    );
    await as(owner, () => db.query(`select reward_set_price('task', $1, 800, 'CZK')`, [priced.id]));
    await as(owner, () =>
      db.query(`select reward_set_price('milestone', $1, 5000, 'CZK', $2)`, [milestone, worker]),
    );
    expect((await entries(worker, milestone)).map((e) => `${e.rule_kind}:${e.status}`)).toEqual([
      "price:planned",
    ]);
    // A worker ticks the priced task off: pending; an imported done task paid nobody.
    await as(account, () => db.query(`update tasks set status = 'done' where id = $1`, [priced.id]));
    expect((await entries(worker, priced.id)).map((e) => `${e.amount}:${e.status}`)).toEqual([
      "800.00:pending",
    ]);
    expect(await entries(worker, imported.id)).toEqual([]);
    // The milestone done: its price and the project_done rule.
    await as(owner, () =>
      db.query(`update milestones set status = 'completed' where id = $1`, [milestone]),
    );
    expect(
      (await entries(worker, milestone)).map((e) => `${e.rule_kind}:${e.amount}:${e.status}`).sort(),
    ).toEqual(["milestone.done:10000.00:pending", "price:5000.00:pending"]);
  });
});

describe("the month, by hand and paying out", () => {
  it("the monthly fixed amount is planned for this month and earned once it ends", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    await plan(worker, [{ kind: "monthly_fixed", amount: 15000 }]);
    await asService(() => db.query(`select reward_run_monthly()`));
    await asService(() => db.query(`select reward_run_monthly()`));
    expect((await entries(worker)).map((e) => `${e.amount}:${e.status}`)).toEqual(["15000.00:planned"]);
    // As if it were last month's: another month's key, ended yesterday.
    await db.query(
      `update reward_entries set occurred_at = now() - interval '1 day', source_id = gen_random_uuid()
       where worker_id = $1`,
      [worker],
    );
    await asService(() => db.query(`select reward_run_monthly()`));
    const statuses = (await entries(worker)).map((e) => e.status).sort();
    expect(statuses).toEqual(["pending", "planned"]);
  });

  it("a reward by hand, a deduction, review, totals and a payout into Finance", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    await plan(worker, [{ kind: "per_call", amount: 10 }]);
    const ids = await as(owner, async () => [
      (await one<{ id: string }>(`select reward_add_manual($1, 1500, 'CZK', current_date, 'Bonus', null, null) as id`, [worker])).id,
      (await one<{ id: string }>(`select reward_add_manual($1, -300, 'CZK', current_date, 'Záloha', null, null) as id`, [worker])).id,
    ]);
    // The worker cannot add one for themself.
    await as(account, async () => {
      await expect(
        db.query(`select reward_add_manual($1, 9999, 'CZK', current_date, 'Já', null, null)`, [worker]),
      ).rejects.toThrow(/reward_forbidden/);
      expect(await rows(`select id from reward_entries`)).toHaveLength(2);
    });
    const totals = await as(owner, () =>
      one<{ approved: string; approved_count: number }>(
        `select approved::text, approved_count from reward_totals(now() - interval '1 month', now() + interval '1 day', $1)`,
        [worker],
      ),
    );
    expect(totals).toEqual({ approved: "1200.00", approved_count: 2 });

    // Reject and approve again.
    await as(owner, () => db.query(`select reward_review($1, 'reject')`, [[ids[0]]]));
    await as(owner, () => db.query(`select reward_review($1, 'approve')`, [[ids[0]]]));

    const month = (await one<{ m: string }>(`select to_char(current_date - (extract(isodow from current_date)::int - 1), 'YYYY-MM') as m`)).m;
    await as(owner, () =>
      db.query(`insert into finance_plan_months (user_id, month, currency) values ($1, $2, 'CZK')`, [owner, month]),
    );
    const payout = await as(owner, () =>
      one<{ id: string }>(`select reward_payout_create($1, $2, current_date, null, 'Odměny') as id`, [worker, ids]),
    );
    const transaction = await one<{ amount: string; category: string; type: string }>(
      `select t.amount::text, t.category, t.type from reward_payouts p join transactions t on t.id = p.transaction_id where p.id = $1`,
      [payout.id],
    );
    expect(transaction).toEqual({ amount: "1200.00", category: "rewards", type: "expense" });
    expect(
      await rows(`select label from finance_plan_rows where user_id = $1 and month = $2 and kind = 'expense'`, [owner, month]),
    ).toEqual([{ label: "Odměny" }]);
    expect((await entries(worker)).map((e) => e.status)).toEqual(["paid", "paid"]);
    // Paid once: a second payout of the same entries fails.
    await as(owner, async () => {
      await expect(
        db.query(`select reward_payout_create($1, $2, current_date, null, 'Odměny')`, [worker, ids]),
      ).rejects.toThrow(/entries_invalid/);
    });
  });
});

describe("the drawn rules become plans", () => {
  it("converts what it can and notes the rest", async () => {
    const account = await createAuthUser();
    const worker = await hire(account);
    await as(owner, () =>
      db.query(`select replace_reward_rules($1)`, [
        JSON.stringify([
          { name: "Úkol", rule: { trigger: "task_completed", kind: "fixed", amount: 200, conditions: { onlyBeforeDue: true, maxPerMonth: 5 } } },
          { name: "Hodina", workerId: worker, rule: { trigger: "hour_worked", kind: "hourly", amount: 300, conditions: { maxPerMonth: 20 } } },
          { name: "Obchod", rule: { trigger: "deal_won", kind: "percent", amount: 5, conditions: { minDealValue: 10000 } } },
        ]),
      ]),
    );
    const skipped = await asService(() =>
      one<{ n: number }>(`select reward_convert_legacy_rules() as n`),
    );
    expect(skipped.n).toBe(1);
    // The drawn rules become rules of 28.2, which 29.1 keeps as event rules.
    const converted = await rows<{ kind: string; definition: unknown }>(
      `select r.kind, r.definition
       from reward_plan_rules r join reward_plans p on p.id = r.plan_id where p.worker_id = $1
       order by r.definition -> 'event' ->> 'key' desc`,
      [worker],
    );
    expect(converted).toEqual([
      {
        kind: "event",
        definition: {
          event: { key: "time.hour" },
          conditions: {},
          reward: { type: "unit", amount: 300 },
          limits: {},
          stack: "sum",
          undo: "keep",
        },
      },
      {
        kind: "event",
        definition: {
          event: { key: "task.done", onTime: true },
          conditions: {},
          reward: { type: "fixed", amount: 200 },
          limits: { cap: 1000 },
          stack: "sum",
          undo: "keep",
        },
      },
      {
        kind: "event",
        definition: {
          event: { key: "deal.won" },
          conditions: { value: { min: 10000 } },
          reward: { type: "percent", percent: 5 },
          limits: {},
          stack: "sum",
          undo: "keep",
        },
      },
    ]);
    const notes = await one<{ notes: string }>(`select notes from reward_plans where worker_id = $1`, [worker]);
    expect(notes.notes).toMatch(/Hodina/);
    expect(await rows(`select id from reward_rules where is_active and owner_id = $1`, [owner])).toEqual([]);
  });
});
