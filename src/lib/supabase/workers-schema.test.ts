// @vitest-environment node
//
// The workers part of the database: invites, reward rules, earnings generated
// by triggers, payments, the work timer and who may see what. Runs every
// migration in PGlite with the same Supabase stubs as schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

let db: PGlite;

async function rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Row>(sql: string, params?: unknown[]): Promise<T> {
  return (await rows<T>(sql, params))[0] as T;
}
async function count(sql: string, params?: unknown[]) {
  return (await one<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).n;
}
async function asUser(uid: string) {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
}
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function asServiceRole() {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
}
async function createAuthUser(locale = "en") {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${crypto.randomUUID()}@example.com`, JSON.stringify({ locale })],
  );
  return id;
}

/** A worker bound to an account, the way an accepted invite leaves it. */
async function hire(ownerId: string, account: string, name = "Pepa") {
  await asServer();
  return (
    await one<{ id: string }>(
      `insert into workers (owner_id, user_id, name, status) values ($1, $2, $3, 'active') returning id`,
      [ownerId, account, name],
    )
  ).id;
}

async function setRules(ownerId: string, rules: unknown[]) {
  await asUser(ownerId);
  await db.query(`select replace_reward_rules($1)`, [JSON.stringify(rules)]);
  await asServer();
}

async function earnings(workerId: string) {
  return rows<{ amount: string; status: string; source: string; basis: string | null }>(
    `select amount::text, status, source, basis::text from worker_earnings
     where worker_id = $1 order by created_at, worker_earnings.amount`,
    [workerId],
  );
}

let owner: string;
let stranger: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser("cs");
  stranger = await createAuthUser();
});

afterAll(async () => {
  await db?.close();
});

describe("worker invites", () => {
  it("lets the database pick the code and expiry, and only the server accept", async () => {
    await asUser(owner);
    const worker = (
      await one<{ id: string }>(
        `insert into workers (owner_id, name, email, job_title) values ($1, 'Jana', 'jana@example.com', 'Obchodnice') returning id`,
        [owner],
      )
    ).id;
    const invite = await one<{ id: string; code: string; days: number }>(
      `insert into worker_invites (owner_id, worker_id, code, expires_at)
       values ($1, $2, 'guessable', now() + interval '10 years')
       returning id, code, extract(day from expires_at - now())::int as days`,
      [owner, worker],
    );
    expect(invite.code).toMatch(/^[0-9a-f]{20}$/);
    expect(invite.days).toBeLessThanOrEqual(7);
    await expect(
      db.query(`update worker_invites set code = 'mine' where id = $1`, [invite.id]),
    ).rejects.toThrow(/invite_code_is_server_only/);
    await expect(
      db.query(`select accept_worker_invite($1, $2)`, [invite.code, owner]),
    ).rejects.toThrow(/permission denied/);

    await asServer();
    const account = await createAuthUser();
    await asServiceRole();
    expect(
      (await one<{ w: string }>(`select accept_worker_invite($1, $2) as w`, [invite.code, account]))
        .w,
    ).toBe(worker);
    await asServer();
    const second = await createAuthUser();
    await asServiceRole();
    await expect(
      db.query(`select accept_worker_invite($1, $2)`, [invite.code, second]),
    ).rejects.toThrow(/invite_invalid/);
    await asServer();

    const bound = await one<{ user_id: string; status: string }>(
      `select user_id, status from workers where id = $1`,
      [worker],
    );
    expect(bound).toEqual({ user_id: account, status: "active" });

    // The owner now sees the worker's profile; a stranger does not.
    await asUser(owner);
    expect(await count(`select 1 from profiles where id = $1`, [account])).toBe(1);
    await asUser(stranger);
    expect(await count(`select 1 from profiles where id = $1`, [account])).toBe(0);
    await asServer();
  });

  it("refuses an expired invite and a second employer for one account", async () => {
    await asUser(owner);
    const worker = (
      await one<{ id: string }>(
        `insert into workers (owner_id, name) values ($1, 'Late') returning id`,
        [owner],
      )
    ).id;
    const code = (
      await one<{ code: string }>(
        `insert into worker_invites (owner_id, worker_id) values ($1, $2) returning code`,
        [owner, worker],
      )
    ).code;
    await asServer();
    await db.query(
      `update worker_invites set expires_at = now() - interval '1 minute' where code = $1`,
      [code],
    );
    const late = await createAuthUser();
    await asServiceRole();
    await expect(db.query(`select accept_worker_invite($1, $2)`, [code, late])).rejects.toThrow(
      /invite_invalid/,
    );
    await asServer();

    const account = await createAuthUser();
    await hire(owner, account, "First job");
    await asUser(stranger);
    const other = (
      await one<{ id: string }>(
        `insert into workers (owner_id, name) values ($1, 'Second job') returning id`,
        [stranger],
      )
    ).id;
    const otherCode = (
      await one<{ code: string }>(
        `insert into worker_invites (owner_id, worker_id) values ($1, $2) returning code`,
        [stranger, other],
      )
    ).code;
    await asServiceRole();
    await expect(
      db.query(`select accept_worker_invite($1, $2)`, [otherCode, account]),
    ).rejects.toThrow(/already_worker/);
    await asServer();
  });
});

describe("reward rules", () => {
  it("accepts only the known shape and keeps replaced rules inactive", async () => {
    await expect(
      setRules(owner, [
        {
          name: "Hourly on a task",
          rule: { trigger: "task_completed", kind: "hourly", amount: 100 },
        },
      ]),
    ).rejects.toThrow(/reward_rules_shape/);
    await asServer();
    await expect(
      setRules(owner, [
        { name: "Too much", rule: { trigger: "deal_won", kind: "percent", amount: 150 } },
      ]),
    ).rejects.toThrow(/reward_rules_shape/);
    await asServer();
    await expect(
      setRules(owner, [
        {
          name: "Unknown condition",
          rule: { trigger: "deal_won", kind: "fixed", amount: 10, conditions: { bonus: true } },
        },
      ]),
    ).rejects.toThrow(/reward_rules_shape/);
    await asServer();

    await setRules(owner, [
      { name: "A", rule: { trigger: "meeting_booked", kind: "fixed", amount: 1 } },
    ]);
    await setRules(owner, [
      { name: "B", rule: { trigger: "meeting_booked", kind: "fixed", amount: 2 } },
    ]);
    const active = await rows<{ name: string }>(
      `select name from reward_rules where owner_id = $1 and is_active`,
      [owner],
    );
    expect(active.map((r) => r.name)).toEqual(["B"]);
    expect(await count(`select 1 from reward_rules where owner_id = $1`, [owner])).toBe(2);

    // A stranger cannot give rules to someone else's worker.
    const worker = await hire(owner, await createAuthUser());
    await expect(
      setRules(stranger, [
        {
          name: "X",
          workerId: worker,
          rule: { trigger: "meeting_booked", kind: "fixed", amount: 1 },
        },
      ]),
    ).rejects.toThrow(/foreign key/);
    await asServer();
  });
});

describe("earnings from triggers", () => {
  let account: string;
  let worker: string;

  beforeAll(async () => {
    account = await createAuthUser();
    worker = await hire(owner, account, "Earner");
    await setRules(owner, [
      { name: "Task", rule: { trigger: "task_completed", kind: "fixed", amount: 200 } },
      {
        name: "On time bonus",
        workerId: worker,
        rule: {
          trigger: "task_completed",
          kind: "fixed",
          amount: 50,
          conditions: { onlyBeforeDue: true, maxPerMonth: 2 },
        },
      },
      { name: "Hour", rule: { trigger: "hour_worked", kind: "hourly", amount: 300 } },
      { name: "Meeting", rule: { trigger: "meeting_booked", kind: "fixed", amount: 150 } },
      {
        name: "Deal",
        rule: {
          trigger: "deal_won",
          kind: "percent",
          amount: 10,
          conditions: { minDealValue: 1000 },
        },
      },
    ]);
  });

  it("pays a done task, once, with the on-time bonus up to its monthly cap", async () => {
    await asUser(owner);
    const tasks = await rows<{ id: string }>(
      `insert into worker_tasks (owner_id, worker_id, title, due_date) values
         ($1, $2, 'On time', current_date + 1),
         ($1, $2, 'Late', current_date - 1),
         ($1, $2, 'Third', null),
         ($1, $2, 'Fourth', null)
       returning id`,
      [owner, worker],
    );
    await asUser(account);
    for (const task of tasks) {
      await db.query(`update worker_tasks set status = 'done' where id = $1`, [task.id]);
    }
    await asServer();
    const task = await rows<{ title: string; amount: string }>(
      `select t.title, e.amount::text from worker_earnings e join worker_tasks t on t.id = e.worker_task_id
       where e.worker_id = $1 and e.source = 'task_completed' order by t.title, e.amount`,
      [worker],
    );
    expect(task).toEqual([
      { title: "Fourth", amount: "200.00" },
      { title: "Late", amount: "200.00" },
      { title: "On time", amount: "50.00" },
      { title: "On time", amount: "200.00" },
      { title: "Third", amount: "50.00" },
      { title: "Third", amount: "200.00" },
    ]);

    // Reopening takes back the pending earnings; an approved one stays and is not paid twice.
    await asUser(owner);
    await db.query(
      `update worker_earnings set status = 'approved' where worker_task_id = $1 and amount = 200`,
      [tasks[0].id],
    );
    await asUser(account);
    await db.query(`update worker_tasks set status = 'todo' where id = $1`, [tasks[0].id]);
    await asServer();
    expect(
      await count(`select 1 from worker_earnings where worker_task_id = $1`, [tasks[0].id]),
    ).toBe(1);
    await asUser(account);
    await db.query(`update worker_tasks set status = 'done' where id = $1`, [tasks[0].id]);
    await asServer();
    // The bonus is back (the cap counts earnings still on record), the base is not doubled.
    expect(
      await rows(
        `select amount::text, status from worker_earnings where worker_task_id = $1 order by worker_earnings.amount`,
        [tasks[0].id],
      ),
    ).toEqual([
      { amount: "50.00", status: "pending" },
      { amount: "200.00", status: "approved" },
    ]);
  });

  it("pays hours when a session closes, meetings once per contact and a share of won deals", async () => {
    await asUser(account);
    const session = await one<{ id: string }>(`select * from start_work_session($1)`, [worker]);
    await asServer();
    await db.query(
      `update work_sessions set started_at = now() - interval '90 minutes' where id = $1`,
      [session.id],
    );
    await db.query(
      `update worker_tasks set updated_at = now() - interval '1 minute' where worker_id = $1`,
      [worker],
    );
    await asUser(account);
    await db.query(`select * from pause_work_session($1)`, [worker]);
    await asServer();
    const hourly = await one<{ amount: string; basis: string }>(
      `select amount::text, basis::text from worker_earnings where work_session_id = $1`,
      [session.id],
    );
    expect(Number(hourly.basis)).toBeCloseTo(1.5, 1);
    expect(Number(hourly.amount)).toBeCloseTo(450, -1);

    // The worker's own contact moved into "Meeting scheduled", twice.
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Pekárna Novák') returning id`,
        [account],
      )
    ).id;
    const { unreached, meeting } = await one<{ unreached: string; meeting: string }>(
      `select (select id from contact_tables where user_id = $1 and system_key = 'unreached') as unreached,
              (select id from contact_tables where user_id = $1 and system_key = 'meeting_scheduled') as meeting`,
      [account],
    );
    for (let i = 0; i < 2; i++) {
      await db.query(
        `insert into contact_table_moves (user_id, contact_id, from_table_id, to_table_id) values ($1, $2, $3, $4)`,
        [account, contact, unreached, meeting],
      );
    }
    expect(
      await rows(
        `select amount::text, description from worker_earnings where source = 'meeting_booked' and worker_id = $1`,
        [worker],
      ),
    ).toEqual([{ amount: "150.00", description: "Pekárna Novák" }]);

    // Deals: 10 % of a won deal worth at least 1000; un-winning takes the pending share back.
    const stages = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(
          `select system_key, id from pipeline_stages where user_id = $1`,
          [account],
        )
      ).map((r) => [r.system_key, r.id]),
    );
    await asUser(account);
    const big = (
      await one<{ id: string }>(
        `insert into deals (user_id, stage_id, title, value) values ($1, $2, 'Big', 25000) returning id`,
        [account, stages.lead],
      )
    ).id;
    await db.query(
      `insert into deals (user_id, stage_id, title, value) values ($1, $2, 'Small', 500)`,
      [account, stages.won],
    );
    await db.query(`update deals set stage_id = $1 where id = $2`, [stages.won, big]);
    await asServer();
    expect(
      await rows(
        `select amount::text, basis::text, description from worker_earnings where source = 'deal_won' and worker_id = $1`,
        [worker],
      ),
    ).toEqual([{ amount: "2500.00", basis: "25000.00", description: "Big" }]);
    await asUser(account);
    await db.query(`update deals set stage_id = $1 where id = $2`, [stages.lead, big]);
    await asServer();
    expect(
      await count(`select 1 from worker_earnings where source = 'deal_won' and worker_id = $1`, [
        worker,
      ]),
    ).toBe(0);
  });

  it("gives nothing to an account that is not a worker", async () => {
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Owner lead') returning id`,
        [owner],
      )
    ).id;
    const meeting = (
      await one<{ id: string }>(
        `select id from contact_tables where user_id = $1 and system_key = 'meeting_scheduled'`,
        [owner],
      )
    ).id;
    const before = await count(`select 1 from worker_earnings`);
    await db.query(
      `insert into contact_table_moves (user_id, contact_id, to_table_id) values ($1, $2, $3)`,
      [owner, contact, meeting],
    );
    expect(await count(`select 1 from worker_earnings`)).toBe(before);
  });

  it("lets the worker read their earnings but never change them", async () => {
    await asUser(account);
    expect((await earnings(worker)).length).toBeGreaterThan(0);
    const changed = await db.query(
      `update worker_earnings set status = 'approved' where worker_id = $1`,
      [worker],
    );
    expect(changed.affectedRows ?? 0).toBe(0);
    await expect(
      db.query(`select * from record_worker_payment($1, 100, now(), null)`, [worker]),
    ).rejects.toThrow(/worker_not_found/);
    await asUser(stranger);
    expect(await earnings(worker)).toEqual([]);
    await asServer();
  });
});

describe("approval and payments", () => {
  let worker: string;

  beforeAll(async () => {
    worker = await hire(owner, await createAuthUser(), "Paid");
    await asUser(owner);
    await db.query(
      `insert into worker_earnings (owner_id, worker_id, amount) values ($1, $2, 100), ($1, $2, 200), ($1, $2, 300)`,
      [owner, worker],
    );
    await asServer();
  });

  it("stamps approval itself and keeps paid to the payment function", async () => {
    await asUser(owner);
    await expect(
      db.query(`update worker_earnings set status = 'paid' where worker_id = $1`, [worker]),
    ).rejects.toThrow(/earning_source_is_server_only/);
    await expect(
      db.query(
        `insert into worker_earnings (owner_id, worker_id, amount, source, source_ref) values ($1, $2, 1, 'deal_won', gen_random_uuid())`,
        [owner, worker],
      ),
    ).rejects.toThrow(/earning_source_is_server_only/);
    await db.query(
      `update worker_earnings set status = 'approved', approved_at = '2000-01-01' where worker_id = $1 and amount in (100, 200)`,
      [worker],
    );
    const stamps = await rows<{ year: number }>(
      `select extract(year from approved_at)::int as year from worker_earnings where worker_id = $1 and status = 'approved'`,
      [worker],
    );
    expect(stamps.every((row) => row.year > 2000)).toBe(true);
    await asServer();
  });

  it("settles approved earnings oldest first and reports the balance", async () => {
    await asUser(owner);
    await db.query(`select * from record_worker_payment($1, 150, now(), 'Cash')`, [worker]);
    let balance = await one<Row>(
      `select earned::text, pending::text, paid_out::text, owed::text from worker_balance($1)`,
      [worker],
    );
    expect(balance).toEqual({
      earned: "300.00",
      pending: "300.00",
      paid_out: "150.00",
      owed: "150.00",
    });
    expect(
      await rows(
        `select amount::text, status from worker_earnings where worker_id = $1 order by worker_earnings.amount`,
        [worker],
      ),
    ).toEqual([
      { amount: "100.00", status: "paid" },
      { amount: "200.00", status: "approved" },
      { amount: "300.00", status: "pending" },
    ]);

    await db.query(`select * from record_worker_payment($1, 150, now(), null)`, [worker]);
    balance = await one<Row>(`select owed::text from worker_balance($1)`, [worker]);
    expect(balance).toEqual({ owed: "0.00" });
    expect(
      await count(`select 1 from worker_earnings where worker_id = $1 and status = 'paid'`, [
        worker,
      ]),
    ).toBe(2);
    await expect(
      db.query(`update worker_earnings set amount = 1 where worker_id = $1 and status = 'paid'`, [
        worker,
      ]),
    ).rejects.toThrow(/earning_paid_is_final/);
    await expect(
      db.query(`select * from record_worker_payment($1, 0, now(), null)`, [worker]),
    ).rejects.toThrow(/amount_invalid/);

    await asUser(stranger);
    await expect(
      db.query(`select * from record_worker_payment($1, 10, now(), null)`, [worker]),
    ).rejects.toThrow(/worker_not_found/);
    expect(await one(`select owed::text from worker_balance($1)`, [worker])).toEqual({ owed: "0" });
    await asServer();
  });
});

describe("work time", () => {
  it("reports the timer, settles idle sessions and sums the month per worker", async () => {
    const account = await createAuthUser();
    const worker = await hire(owner, account, "Timer");
    await asUser(account);
    await db.query(`select * from start_work_session($1)`, [worker]);
    const status = await one<{ running: boolean; worker_id: string; idle_deadline: Date | null }>(
      `select * from work_status('Europe/Prague')`,
    );
    expect(status.running).toBe(true);
    expect(status.worker_id).toBe(worker);
    expect(status.idle_deadline).not.toBeNull();

    // Left open for 40 minutes without touching a task: cut at 15.
    await asServer();
    await db.query(
      `update work_sessions set started_at = now() - interval '40 minutes' where worker_id = $1 and ended_at is null`,
      [worker],
    );
    await asUser(owner);
    expect((await one<{ n: number }>(`select settle_idle_work_sessions() as n`)).n).toBe(1);
    const stats = await one<{ work_seconds: number; tasks_total: number }>(
      `select * from worker_month_stats(date_trunc('month', now() at time zone 'Europe/Prague')::date, 'Europe/Prague')
       where worker_id = $1`,
      [worker],
    );
    expect(Math.abs(stats.work_seconds - 15 * 60)).toBeLessThan(5);
    expect(stats.tasks_total).toBe(0);
    expect(
      (
        await rows<{ running: boolean }>(`select * from worker_sessions($1, 10, null)`, [worker])
      ).map((row) => row.running),
    ).toEqual([false]);

    await asUser(account);
    const after = await one<{ running: boolean; month_seconds: number }>(
      `select * from work_status('Europe/Prague')`,
    );
    expect(after.running).toBe(false);
    expect(Math.abs(after.month_seconds - 15 * 60)).toBeLessThan(5);

    // Nobody else sees the worker in their stats.
    await asUser(stranger);
    expect(
      await count(
        `select 1 from worker_month_stats(current_date, 'Europe/Prague') where worker_id = $1`,
        [worker],
      ),
    ).toBe(0);
    await expect(db.query(`select * from work_status('Europe/Prague')`)).rejects.toThrow(
      /worker_not_found/,
    );
    await asServer();
  });
});

describe("reward drafts", () => {
  it("belong to their owner only", async () => {
    await asUser(owner);
    await db.query(`insert into reward_drafts (owner_id, tree) values ($1, '{"branches": []}')`, [
      owner,
    ]);
    await asUser(stranger);
    expect(await count(`select 1 from reward_drafts`)).toBe(0);
    await expect(
      db.query(`insert into reward_drafts (owner_id) values ($1)`, [owner]),
    ).rejects.toThrow(/row-level security/);
    await asServer();
  });
});
