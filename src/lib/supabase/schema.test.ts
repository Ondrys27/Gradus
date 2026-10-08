// @vitest-environment node
//
// Runs the real migration in an in-process Postgres (PGlite) with the same
// auth/storage stubs Supabase provides, then checks the business rules that
// live in the database: account initialisation, RLS, contact moves, won deals,
// task locking and the idle rule of the prospecting timer.

import { PGlite } from "@electric-sql/pglite";
import { PGLITE_EXTENSIONS } from "./pglite-extensions";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
  const r = await rows<T>(sql, params);
  return r[0] as T;
}
async function count(sql: string, params?: unknown[]) {
  return (await one<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).n;
}
async function asUser(uid: string) {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
}
async function asAnon() {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role anon;`);
}
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function createAuthUser(locale = "en") {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${crypto.randomUUID()}@example.com`, JSON.stringify({ locale })],
  );
  return id;
}

let owner: string;
let second: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser("cs");
  second = await createAuthUser("en");
});

afterAll(async () => {
  await db?.close();
});

describe("initialize_user", () => {
  it("creates profile, settings, subscription, six stages and seven tables", async () => {
    expect(await count(`select 1 from profiles where id = $1`, [owner])).toBe(1);
    expect((await one(`select locale from user_settings where user_id = $1`, [owner])).locale).toBe(
      "cs",
    );
    expect(
      (await one(`select plan_key from subscriptions where user_id = $1`, [owner])).plan_key,
    ).toBe("beta");
    expect(await count(`select 1 from pipeline_stages where user_id = $1`, [owner])).toBe(6);
    expect(await count(`select 1 from contact_tables where user_id = $1`, [owner])).toBe(7);
  });

  it("makes the first account owner and the next ones user", async () => {
    expect((await one(`select role from user_roles where user_id = $1`, [owner])).role).toBe(
      "owner",
    );
    expect((await one(`select role from user_roles where user_id = $1`, [second])).role).toBe(
      "user",
    );
  });

  it("is idempotent", async () => {
    await db.exec(`select initialize_user('${owner}', 'cs')`);
    expect(await count(`select 1 from user_roles where user_id = $1`, [owner])).toBe(1);
    expect(await count(`select 1 from contact_tables where user_id = $1`, [owner])).toBe(7);
  });

  it("seeds dependent questions for the unsuccessful table", async () => {
    const fields = await rows<{ label: string; depends_on_value: string | null }>(
      `select f.label, f.depends_on_value from contact_table_fields f
       join contact_tables t on t.id = f.table_id
       where t.user_id = $1 and t.system_key = 'failed' order by f.position`,
      [owner],
    );
    expect(fields.map((f) => f.depends_on_value)).toEqual([
      null,
      "not_interested",
      "not_target_group",
      "other",
    ]);
  });
});

describe("row level security", () => {
  it("shows a user only their own rows", async () => {
    await asUser(second);
    expect(await count(`select 1 from contact_tables`)).toBe(7);
    expect(await count(`select 1 from contact_tables where user_id = $1`, [owner])).toBe(0);
    await asServer();
  });

  it("blocks client writes to server-only tables", async () => {
    await asUser(owner);
    await expect(
      db.query(`insert into user_roles (user_id, role) values ('${owner}', 'admin')`),
    ).rejects.toThrow(/row-level security/);
    // usage_events is history only now: nobody may write it at all.
    await expect(
      db.query(`insert into usage_events (user_id, event_type) values ('${owner}', 'x')`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(`insert into analytics_events (user_id, event) values ('${owner}', 'page_viewed')`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        `insert into ai_usage (user_id, purpose, model) values ('${owner}', 'chat', 'haiku')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.query(`insert into call_time_stats (country_code, day_of_week, hour) values ('CZ', 1, 9)`),
    ).rejects.toThrow(/row-level security/);
    await expect(db.query(`select initialize_user('${owner}', 'en')`)).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });
});

describe("contact tables", () => {
  let contact: string;
  let tables: Record<string, string>;

  beforeAll(async () => {
    await asUser(owner);
    contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ('${owner}', 'Acme') returning id`,
      )
    ).id;
    tables = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(`select system_key, id from contact_tables`)
      ).map((r) => [r.system_key, r.id]),
    );
  });

  it("keeps a contact in exactly one table and records every move", async () => {
    await db.query(`select move_contact($1, $2, '{}')`, [contact, tables.unreached]);
    const reason = (
      await one<{ id: string }>(
        `select id from contact_table_fields where table_id = $1 and system_key = 'reason'`,
        [tables.failed],
      )
    ).id;
    const entry = await one<{ table_id: string }>(`select * from move_contact($1, $2, $3)`, [
      contact,
      tables.failed,
      JSON.stringify({ [reason]: "other" }),
    ]);
    expect(entry.table_id).toBe(tables.failed);
    expect(
      await count(`select 1 from contact_table_entries where contact_id = $1`, [contact]),
    ).toBe(1);
    expect(await count(`select 1 from contact_table_moves where contact_id = $1`, [contact])).toBe(
      2,
    );
  });

  it("refuses manual moves into the system clients table", async () => {
    await expect(
      db.query(`select move_contact('${contact}', '${tables.clients}', '{}')`),
    ).rejects.toThrow(/cannot_move_into_system_table/);
  });

  it("puts the contact into clients when its deal is won", async () => {
    const stages = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(`select system_key, id from pipeline_stages`)
      ).map((r) => [r.system_key, r.id]),
    );
    const deal = await one<{ id: string; entered_stage_at: string; won_at: string | null }>(
      `insert into deals (user_id, contact_id, stage_id, title) values ('${owner}', '${contact}', '${stages.lead}', 'Deal') returning *`,
    );
    expect(deal.won_at).toBeNull();
    const won = await one<{ won_at: string | null }>(
      `update deals set stage_id = '${stages.won}' where id = '${deal.id}' returning *`,
    );
    expect(won.won_at).not.toBeNull();
    expect(
      (await one(`select table_id from contact_table_entries where contact_id = $1`, [contact]))
        .table_id,
    ).toBe(tables.clients);
  });
});

describe("pipeline", () => {
  let stages: Record<string, string>;

  async function newContact(name: string) {
    return (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ('${owner}', '${name}') returning id`,
      )
    ).id;
  }
  async function newDeal(stage: string, contact: string | null = null) {
    return await one<{ id: string; won_at: string | null; lost_at: string | null }>(
      `insert into deals (user_id, contact_id, stage_id, title)
       values ('${owner}', ${contact ? `'${contact}'` : "null"}, '${stage}', 'Deal') returning *`,
    );
  }
  async function clientsCount(contact: string) {
    return count(
      `select 1 from contact_table_entries e join contact_tables t on t.id = e.table_id
       where e.contact_id = '${contact}' and t.system_key = 'clients'`,
    );
  }

  beforeAll(async () => {
    await asUser(owner);
    stages = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(
          `select system_key, id from pipeline_stages where user_id = '${owner}'`,
        )
      ).map((r) => [r.system_key, r.id]),
    );
  });

  it("puts the contact of a won deal into clients, once, and keeps it there on return", async () => {
    const contact = await newContact("Won Ltd");
    const deal = await newDeal(stages.lead, contact);
    expect(await clientsCount(contact)).toBe(0);
    await db.query(`update deals set stage_id = '${stages.won}' where id = '${deal.id}'`);
    expect(await clientsCount(contact)).toBe(1);
    await db.query(`update deals set stage_id = '${stages.offer}' where id = '${deal.id}'`);
    await db.query(`update deals set stage_id = '${stages.won}' where id = '${deal.id}'`);
    expect(await clientsCount(contact)).toBe(1);
    expect(await count(`select 1 from contact_table_entries where contact_id = '${contact}'`)).toBe(
      1,
    );
  });

  it("wins a deal without a contact without touching any table", async () => {
    const deal = await newDeal(stages.lead);
    const won = await one<{ won_at: string | null }>(
      `update deals set stage_id = '${stages.won}' where id = '${deal.id}' returning *`,
    );
    expect(won.won_at).not.toBeNull();
  });

  it("stamps and clears won_at, lost_at and the lost reason with the stage", async () => {
    const deal = await newDeal(stages.lead);
    const lost = await one<{ lost_at: string | null; won_at: string | null; lost_reason: string }>(
      `update deals set stage_id = '${stages.lost}', lost_reason = 'Too expensive'
       where id = '${deal.id}' returning *`,
    );
    expect(lost.lost_at).not.toBeNull();
    expect(lost.won_at).toBeNull();
    expect(lost.lost_reason).toBe("Too expensive");
    const back = await one<{ lost_at: string | null; lost_reason: string | null }>(
      `update deals set stage_id = '${stages.meeting}' where id = '${deal.id}' returning *`,
    );
    expect(back.lost_at).toBeNull();
    expect(back.lost_reason).toBeNull();
  });

  it("refuses to remove the last stage but removes others, moving their deals", async () => {
    const extra = (
      await one<{ id: string }>(
        `insert into pipeline_stages (user_id, name, position) values ('${owner}', 'Extra', 9) returning id`,
      )
    ).id;
    const deal = await newDeal(extra);
    await expect(db.query(`select remove_stage('${extra}')`)).rejects.toThrow(
      /target_stage_required/,
    );
    await db.query(`select remove_stage('${extra}', '${stages.meeting}')`);
    expect(
      (await one<{ stage_id: string }>(`select stage_id from deals where id = '${deal.id}'`))
        .stage_id,
    ).toBe(stages.meeting);

    await asUser(second);
    const others = await rows<{ id: string }>(`select id from pipeline_stages`);
    for (const { id } of others.slice(0, -1)) {
      await db.query(`select remove_stage('${id}')`);
    }
    await expect(db.query(`select remove_stage('${others.at(-1)!.id}')`)).rejects.toThrow(
      /last_stage/,
    );
    await asUser(owner);
  });
});

describe("tasks", () => {
  it("locks a parent until its subtasks are done and never completes it by itself", async () => {
    await asUser(owner);
    const milestone = (
      await one<{ id: string }>(
        `insert into milestones (user_id, title) values ('${owner}', 'M') returning id`,
      )
    ).id;
    const parent = (
      await one<{ id: string }>(
        `insert into tasks (user_id, milestone_id, title) values ('${owner}', '${milestone}', 'parent') returning id`,
      )
    ).id;
    const child = (
      await one<{ id: string }>(
        `insert into tasks (user_id, milestone_id, parent_task_id, title) values ('${owner}', '${milestone}', '${parent}', 'child') returning id`,
      )
    ).id;

    await expect(
      db.query(`update tasks set status = 'done' where id = '${parent}'`),
    ).rejects.toThrow(/task_has_open_subtasks/);
    await db.exec(`update tasks set status = 'done' where id = '${child}'`);
    expect((await one(`select status from tasks where id = '${parent}'`)).status).toBe("todo");

    await db.exec(`update tasks set status = 'done' where id = '${parent}'`);
    expect(
      (await one(`select completed_at from tasks where id = '${parent}'`)).completed_at,
    ).not.toBeNull();

    await db.exec(`update tasks set status = 'todo' where id = '${child}'`);
    const reopened = await one(`select status, completed_at from tasks where id = '${parent}'`);
    expect(reopened.status).toBe("in_progress");
    expect(reopened.completed_at).toBeNull();
    await asServer();
  });

  it("counts every task of a milestone, subtasks included, only for its owner", async () => {
    await asUser(owner);
    const milestone = (
      await one<{ id: string }>(
        `insert into milestones (user_id, title) values ('${owner}', 'Counted') returning id`,
      )
    ).id;
    const parent = (
      await one<{ id: string }>(
        `insert into tasks (user_id, milestone_id, title) values ('${owner}', '${milestone}', 'a') returning id`,
      )
    ).id;
    await db.exec(
      `insert into tasks (user_id, milestone_id, parent_task_id, title, status)
       values ('${owner}', '${milestone}', '${parent}', 'b', 'done')`,
    );
    await db.exec(
      `insert into tasks (user_id, milestone_id, title) values ('${owner}', '${milestone}', 'c')`,
    );
    const counts = await one<{ total: number; done: number }>(
      `select total, done from milestone_task_counts where milestone_id = $1`,
      [milestone],
    );
    expect(counts).toEqual({ total: 3, done: 1 });

    await asUser(second);
    expect(
      await count(`select 1 from milestone_task_counts where milestone_id = $1`, [milestone]),
    ).toBe(0);
    await asServer();
  });
});

describe("milestone completion", () => {
  const statusOf = async (id: string) =>
    one<{ status: string; completed_at: string | null }>(
      `select status, completed_at from milestones where id = $1`,
      [id],
    );

  it("completes only with at least one task, all done, and reopens on an unticked task", async () => {
    const user = await createAuthUser();
    await asUser(user);
    const milestone = (
      await one<{ id: string }>(
        `insert into milestones (user_id, title) values ($1, 'Launch') returning id`,
        [user],
      )
    ).id;

    await expect(
      db.query(`update milestones set status = 'completed' where id = $1`, [milestone]),
    ).rejects.toThrow(/milestone_has_no_tasks/);

    const parent = (
      await one<{ id: string }>(
        `insert into tasks (user_id, milestone_id, title) values ($1, $2, 'p') returning id`,
        [user, milestone],
      )
    ).id;
    const child = (
      await one<{ id: string }>(
        `insert into tasks (user_id, milestone_id, parent_task_id, title) values ($1, $2, $3, 'c') returning id`,
        [user, milestone, parent],
      )
    ).id;
    await db.query(`update tasks set status = 'done' where id = $1`, [child]);
    await expect(
      db.query(`update milestones set status = 'completed' where id = $1`, [milestone]),
    ).rejects.toThrow(/milestone_has_open_tasks/);
    // Everything done is not enough on its own: the milestone waits for the user.
    await db.query(`update tasks set status = 'done' where id = $1`, [parent]);
    expect((await statusOf(milestone)).status).toBe("active");

    await db.query(`update milestones set status = 'completed' where id = $1`, [milestone]);
    expect((await statusOf(milestone)).completed_at).not.toBeNull();

    // Unticking a subtask reopens its parent and the milestone.
    await db.query(`update tasks set status = 'todo' where id = $1`, [child]);
    expect(await statusOf(milestone)).toEqual({ status: "active", completed_at: null });

    await db.query(`update tasks set status = 'done' where id = $1`, [child]);
    await db.query(`update tasks set status = 'done' where id = $1`, [parent]);
    await db.query(`update milestones set status = 'completed' where id = $1`, [milestone]);
    // A new open task reopens it too.
    await db.query(`insert into tasks (user_id, milestone_id, title) values ($1, $2, 'more')`, [
      user,
      milestone,
    ]);
    expect((await statusOf(milestone)).status).toBe("active");
    await asServer();
  });

  it("refuses a milestone created as completed and bounds the reward", async () => {
    const user = await createAuthUser();
    await asUser(user);
    await expect(
      db.query(`insert into milestones (user_id, title, status) values ($1, 'x', 'completed')`, [
        user,
      ]),
    ).rejects.toThrow(/milestone_has_no_tasks/);

    const row = await one<{ reward: string | null }>(
      `insert into milestones (user_id, title, reward) values ($1, 'y', 'Weekend in the mountains') returning reward`,
      [user],
    );
    expect(row.reward).toBe("Weekend in the mountains");
    await expect(
      db.query(`insert into milestones (user_id, title, reward) values ($1, 'z', $2)`, [
        user,
        "x".repeat(121),
      ]),
    ).rejects.toThrow(/milestones_reward_length/);
    await expect(
      db.query(`insert into milestones (user_id, title, reward) values ($1, 'z', '')`, [user]),
    ).rejects.toThrow(/milestones_reward_length/);
    await asServer();
  });

  it("does not let one user reopen another user's milestone through a task", async () => {
    const owner = await createAuthUser();
    const other = await createAuthUser();
    await asUser(owner);
    const milestone = (
      await one<{ id: string }>(
        `insert into milestones (user_id, title) values ($1, 'Mine') returning id`,
        [owner],
      )
    ).id;
    await db.query(
      `insert into tasks (user_id, milestone_id, title, status) values ($1, $2, 't', 'done')`,
      [owner, milestone],
    );
    await db.query(`update milestones set status = 'completed' where id = $1`, [milestone]);

    await asUser(other);
    await expect(
      db.query(`insert into tasks (user_id, milestone_id, title) values ($1, $2, 'sneak')`, [
        other,
        milestone,
      ]),
    ).rejects.toThrow();
    await asServer();
    expect((await statusOf(milestone)).status).toBe("completed");
  });
});

describe("prospecting timer", () => {
  it("cuts an idle segment 15 minutes after the last move out of unreached", async () => {
    await asUser(owner);
    const segment = await one<{ id: string }>(`select * from start_prospecting()`);
    expect((await one<{ id: string }>(`select * from start_prospecting()`)).id).toBe(segment.id);

    await asServer();
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ('${owner}', 'Idle s.r.o.') returning id`,
      )
    ).id;
    const { unreached, meeting } = await one<{ unreached: string; meeting: string }>(
      `select (select id from contact_tables where user_id = $1 and system_key = 'unreached') as unreached,
              (select id from contact_tables where user_id = $1 and system_key = 'meeting_scheduled') as meeting`,
      [owner],
    );
    await db.exec(
      `update prospecting_segments set started_at = now() - interval '40 minutes' where id = '${segment.id}'`,
    );
    await db.exec(
      `update contact_table_moves set created_at = now() - interval '50 minutes' where user_id = '${owner}'`,
    );
    await db.exec(
      `insert into contact_table_moves (user_id, actor_id, contact_id, from_table_id, to_table_id, created_at)
       values ('${owner}', '${owner}', '${contact}', '${unreached}', '${meeting}', now() - interval '20 minutes')`,
    );

    await asUser(owner);
    const seconds = (
      await one<{ s: number }>(
        `select prospecting_seconds_for_day(current_date, 'Europe/Prague') as s`,
      )
    ).s;
    expect(Math.abs(seconds - 35 * 60)).toBeLessThan(5);

    const closed = await one<{ end_reason: string }>(`select * from pause_prospecting()`);
    expect(closed.end_reason).toBe("idle");

    const fresh = await one<{ id: string }>(`select * from start_prospecting()`);
    expect(fresh.id).not.toBe(segment.id);
    expect(
      (await one<{ end_reason: string }>(`select * from pause_prospecting()`)).end_reason,
    ).toBe("pause");
    await asServer();
  });
});

describe("workers", () => {
  it("lets a worker read their own records but not create earnings", async () => {
    await asServer();
    const worker = (
      await one<{ id: string }>(
        `insert into workers (owner_id, user_id, name, status) values ('${owner}', '${second}', 'Pepa', 'active') returning id`,
      )
    ).id;
    await db.exec(
      `insert into worker_tasks (owner_id, worker_id, title, assigned_by) values ('${owner}', '${worker}', 'Do it', '${owner}')`,
    );

    await asUser(second);
    expect(await count(`select 1 from workers`)).toBe(1);
    expect(await count(`select 1 from worker_tasks`)).toBe(1);
    await expect(
      db.query(
        `insert into worker_earnings (owner_id, worker_id, amount) values ('${owner}', '${worker}', 100)`,
      ),
    ).rejects.toThrow(/row-level security/);
    const session = await one<{ id: string }>(`select * from start_work_session($1)`, [worker]);
    expect(session.id).toBeTruthy();
    expect((await one<{ id: string }>(`select * from start_work_session($1)`, [worker])).id).toBe(
      session.id,
    );
    expect(
      (await one<{ end_reason: string }>(`select * from pause_work_session($1)`, [worker]))
        .end_reason,
    ).toBe("pause");
    await asServer();

    await asUser(owner);
    await expect(db.query(`select * from start_work_session($1)`, [worker])).rejects.toThrow(
      /worker_not_found/,
    );
    expect(await count(`select 1 from work_sessions where worker_id = $1`, [worker])).toBe(1);
    await asServer();
  });
});

describe("profiles", () => {
  it("accepts only lowercase usernames of 3–20 allowed characters", async () => {
    await asUser(owner);
    await db.query(`update profiles set username = 'ondra.otava_1' where id = $1`, [owner]);
    for (const bad of ["ab", "Ondra", "a".repeat(21), "ondra-otava", "ondra otava"]) {
      await expect(
        db.query(`update profiles set username = $1 where id = $2`, [bad, owner]),
      ).rejects.toThrow(/profiles_username_format/);
    }
    await asServer();
  });

  it("answers availability without exposing other profiles", async () => {
    await asUser(second);
    const available = async (name: string) =>
      (await one<{ ok: boolean }>(`select username_available($1) as ok`, [name])).ok;
    expect(await available("ondra.otava_1")).toBe(false);
    expect(await available("someone_else")).toBe(true);
    expect(await available("X")).toBe(false);
    expect(await count(`select 1 from profiles where id = $1`, [owner])).toBe(0);
    await expect(
      db.query(`update profiles set username = 'ondra.otava_1' where id = $1`, [second]),
    ).rejects.toThrow(/duplicate key/);
    await asServer();

    await asUser(owner);
    expect(await available("ondra.otava_1")).toBe(true); // own name stays available to its owner
    await asServer();
  });
});

describe("onboarding", () => {
  it("starts unset and the owner can save their branch and completion", async () => {
    expect(
      (await one(`select industry, onboarding_completed_at from profiles where id = $1`, [owner]))
        .onboarding_completed_at,
    ).toBeNull();

    await asUser(owner);
    await db.query(
      `update profiles set industry = 'coaching', onboarding_completed_at = now() where id = $1`,
      [owner],
    );
    await asServer();

    const row = await one<{ industry: string; onboarding_completed_at: string }>(
      `select industry, onboarding_completed_at from profiles where id = $1`,
      [owner],
    );
    expect(row.industry).toBe("coaching");
    expect(row.onboarding_completed_at).not.toBeNull();
  });
});

describe("user settings", () => {
  it("rejects formats that format.ts does not understand", async () => {
    await asUser(owner);
    await db.query(
      `update user_settings set date_format = 'MM/dd/yyyy', time_format = 'h:mm a', number_format = 'en', first_day_of_week = 0 where user_id = $1`,
      [owner],
    );
    await expect(
      db.query(`update user_settings set date_format = 'yyyy' where user_id = $1`, [owner]),
    ).rejects.toThrow(/user_settings_date_format_check/);
    await expect(
      db.query(`update user_settings set first_day_of_week = 3 where user_id = $1`, [owner]),
    ).rejects.toThrow(/user_settings_first_day_check/);
    await expect(
      db.query(`update user_settings set locale = 'de' where user_id = $1`, [owner]),
    ).rejects.toThrow(/user_settings_locale_check/);
    await asServer();
  });
});

describe("avatars storage", () => {
  it("lets a user write only inside their own folder", async () => {
    await asUser(owner);
    await db.query(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [
      `${owner}/avatar`,
    ]);
    await expect(
      db.query(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [
        `${second}/avatar`,
      ]),
    ).rejects.toThrow(/row-level security/);
    await asServer();

    await asUser(second);
    expect(await count(`select 1 from storage.objects where bucket_id = 'avatars'`)).toBe(0);
    await db.query(`delete from storage.objects where name = $1`, [`${owner}/avatar`]);
    await asServer();
    expect(await count(`select 1 from storage.objects where name = $1`, [`${owner}/avatar`])).toBe(
      1,
    );

    const bucket = await one<{ public: boolean; file_size_limit: number }>(
      `select public, file_size_limit from storage.buckets where id = 'avatars'`,
    );
    expect(bucket).toEqual({ public: true, file_size_limit: 2097152 });
  });
});

describe("security: an ordinary signed-in account", () => {
  let attacker: string;
  let victim: string;
  let victimContact: string;

  beforeAll(async () => {
    attacker = await createAuthUser();
    victim = await createAuthUser();
    victimContact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Victim s.r.o.') returning id`,
        [victim],
      )
    ).id;
  });

  it("has RLS on every table in public", async () => {
    const open = await rows<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(open).toEqual([]);
  });

  it("cannot grant itself a role; has_role is SECURITY DEFINER and closed to anon", async () => {
    const writePolicies = await rows(
      `select policyname from pg_policies where tablename = 'user_roles' and cmd <> 'SELECT'`,
    );
    expect(writePolicies).toEqual([]);
    const fn = await one<{ prosecdef: boolean; config: string[] }>(
      `select prosecdef, proconfig as config from pg_proc where proname = 'has_role'`,
    );
    expect(fn).toEqual({ prosecdef: true, config: ['search_path=""'] });

    await asUser(attacker);
    await expect(
      db.query(`update user_roles set role = 'owner' where user_id = $1`, [attacker]),
    ).resolves.toMatchObject({ affectedRows: 0 });
    expect((await one(`select role from user_roles`)).role).toBe("user");
    await asAnon();
    await expect(db.query(`select has_role($1, 'owner')`, [owner])).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });

  it("cannot see or reference another user's rows", async () => {
    await asUser(attacker);
    expect(await count(`select 1 from contacts`)).toBe(0);
    const lead = (
      await one<{ id: string }>(`select id from pipeline_stages where system_key = 'lead'`)
    ).id;
    await expect(
      db.query(
        `insert into deals (user_id, contact_id, stage_id, title) values ($1, $2, $3, 'x')`,
        [attacker, victimContact, lead],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query(
        `insert into calendar_events (user_id, title, starts_at, contact_id) values ($1, 'x', now(), $2)`,
        [attacker, victimContact],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query(
        `insert into attachments (user_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes)
         values ($1, 'contact', gen_random_uuid(), $2, 'a.pdf', 'application/pdf', 1)`,
        [attacker, `${victim}/secret.pdf`],
      ),
    ).rejects.toThrow(/row-level security/);
    await asServer();
  });

  it("changes contact membership only through move_contact", async () => {
    await asUser(attacker);
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Mine') returning id`,
        [attacker],
      )
    ).id;
    const tables = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(`select system_key, id from contact_tables`)
      ).map((r) => [r.system_key, r.id]),
    );
    await expect(
      db.query(
        `insert into contact_table_entries (user_id, contact_id, table_id) values ($1, $2, $3)`,
        [attacker, contact, tables.clients],
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.query(
        `insert into contact_table_moves (user_id, contact_id, from_table_id, to_table_id) values ($1, $2, $3, $4)`,
        [attacker, contact, tables.unreached, tables.meeting_scheduled],
      ),
    ).rejects.toThrow(/row-level security/);

    await db.query(`select move_contact($1, $2)`, [contact, tables.unreached]);
    expect((await db.query(`delete from contact_table_entries`)).affectedRows).toBe(0);

    await expect(
      db.query(`delete from contact_tables where id = $1`, [tables.clients]),
    ).rejects.toThrow(/system_table_readonly/);
    await expect(
      db.query(`update contact_tables set system_key = 'unreached' where id = $1`, [
        tables.no_answer,
      ]),
    ).rejects.toThrow(/system_table_readonly/);
    await asServer();
  });

  it("cannot write or reset the prospecting timer directly", async () => {
    await asUser(attacker);
    await expect(
      db.query(
        `insert into prospecting_segments (user_id, started_at, ended_at, end_reason)
         values ($1, now() - interval '10 hours', now(), 'pause')`,
        [attacker],
      ),
    ).rejects.toThrow(/row-level security/);
    const segment = await one<{ id: string }>(`select * from start_prospecting()`);
    expect(
      (await db.query(`update prospecting_segments set started_at = now() - interval '9 hours'`))
        .affectedRows,
    ).toBe(0);
    expect((await db.query(`delete from prospecting_segments`)).affectedRows).toBe(0);
    await db.query(`select pause_prospecting()`);
    expect(await count(`select 1 from prospecting_segments where id = $1`, [segment.id])).toBe(1);
    await asServer();
  });

  it("as a worker, cannot log time, edit the task or create earnings", async () => {
    const worker = (
      await one<{ id: string }>(
        `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Útočník', 'active') returning id`,
        [victim, attacker],
      )
    ).id;
    const task = (
      await one<{ id: string }>(
        `insert into worker_tasks (owner_id, worker_id, title) values ($1, $2, 'Call 20 leads') returning id`,
        [victim, worker],
      )
    ).id;

    await asUser(attacker);
    await expect(
      db.query(
        `insert into work_sessions (owner_id, worker_id, started_at, ended_at, end_reason)
         values ($1, $2, now() - interval '12 hours', now(), 'pause')`,
        [victim, worker],
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.query(`update worker_tasks set title = 'Nothing' where id = $1`, [task]),
    ).rejects.toThrow(/worker_may_only_change_status/);
    await db.query(`update worker_tasks set status = 'done' where id = $1`, [task]);
    expect((await one(`select status from worker_tasks where id = $1`, [task])).status).toBe(
      "done",
    );
    await asServer();
  });

  it("as an owner, cannot bind someone else's account or accept its own invite", async () => {
    await asUser(attacker);
    await expect(
      db.query(`insert into workers (owner_id, user_id, name) values ($1, $2, 'x')`, [
        attacker,
        victim,
      ]),
    ).rejects.toThrow(/worker_account_link_is_server_only/);
    const worker = (
      await one<{ id: string }>(
        `insert into workers (owner_id, name) values ($1, 'x') returning id`,
        [attacker],
      )
    ).id;
    await expect(
      db.query(`update workers set user_id = $1 where id = $2`, [victim, worker]),
    ).rejects.toThrow(/worker_account_link_is_server_only/);
    const invite = (
      await one<{ id: string }>(
        `insert into worker_invites (owner_id, worker_id) values ($1, $2) returning id`,
        [attacker, worker],
      )
    ).id;
    await expect(
      db.query(`update worker_invites set accepted_at = now(), accepted_by = $1 where id = $2`, [
        victim,
        invite,
      ]),
    ).rejects.toThrow(/invite_acceptance_is_server_only/);
    await asServer();
  });

  it("cannot resolve its own feature request", async () => {
    await asUser(attacker);
    const request = (
      await one<{ id: string }>(
        `insert into feature_requests (user_id, title) values ($1, 'Dark mode') returning id`,
        [attacker],
      )
    ).id;
    await db.query(`update feature_requests set title = 'Dark mode please' where id = $1`, [
      request,
    ]);
    await expect(
      db.query(`update feature_requests set status = 'done' where id = $1`, [request]),
    ).rejects.toThrow(/feature_request_status_is_admin_only/);
    await asServer();

    await asUser(owner);
    await db.query(`update feature_requests set status = 'planned' where id = $1`, [request]);
    await asServer();
  });
});

describe("security: server-owned rows and columns", () => {
  let user: string;

  beforeAll(async () => {
    user = await createAuthUser();
  });

  it("leaves Jarvis output and unlocks to the server", async () => {
    await asServer();
    const conversation = (
      await one<{ id: string }>(
        `insert into jarvis_conversations (user_id) values ($1) returning id`,
        [user],
      )
    ).id;
    await db.query(`insert into unlocks (user_id, key) values ($1, 'first_deal')`, [user]);

    await asUser(user);
    await expect(
      db.query(
        `insert into jarvis_messages (user_id, conversation_id, role, content) values ($1, $2, 'assistant', 'fake')`,
        [user, conversation],
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.query(`insert into sales_analyses (user_id, content) values ($1, 'fake')`, [user]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.query(`insert into unlocks (user_id, key) values ($1, 'everything')`, [user]),
    ).rejects.toThrow(/row-level security/);
    await db.query(`update unlocks set seen_at = now()`);
    await expect(db.query(`update unlocks set key = 'everything'`)).rejects.toThrow(
      /unlocks_are_server_only/,
    );

    const milestone = await one<{ id: string; ai_feedback: string | null }>(
      `insert into milestones (user_id, title, ai_feedback) values ($1, 'M', 'Perfect!') returning *`,
      [user],
    );
    expect(milestone.ai_feedback).toBeNull();
    await asServer();
  });

  it("stamps completion and stage times from the status, not from the client", async () => {
    await asUser(user);
    const milestone = (
      await one<{ id: string }>(
        `insert into milestones (user_id, title) values ($1, 'M2') returning id`,
        [user],
      )
    ).id;
    const task = await one<{ id: string; completed_at: string }>(
      `insert into tasks (user_id, milestone_id, title, status, completed_at)
       values ($1, $2, 't', 'done', '2020-01-01') returning *`,
      [user, milestone],
    );
    expect(new Date(task.completed_at).getFullYear()).toBeGreaterThan(2020);
    const after = await one<{ completed_at: string }>(
      `update tasks set completed_at = '2020-01-01', title = 't2' where id = $1 returning *`,
      [task.id],
    );
    expect(after.completed_at).toEqual(task.completed_at);

    const completed = await one<{ completed_at: string | null }>(
      `update milestones set status = 'completed', completed_at = '2020-01-01' where id = $1 returning *`,
      [milestone],
    );
    expect(new Date(completed.completed_at!).getFullYear()).toBeGreaterThan(2020);

    const lead = (
      await one<{ id: string }>(`select id from pipeline_stages where system_key = 'lead'`)
    ).id;
    const deal = await one<{ id: string; won_at: string | null }>(
      `insert into deals (user_id, stage_id, title, won_at) values ($1, $2, 'd', now()) returning *`,
      [user, lead],
    );
    expect(deal.won_at).toBeNull();
    const edited = await one<{ won_at: string | null; entered_stage_at: string }>(
      `update deals set won_at = now(), entered_stage_at = '2020-01-01' where id = $1 returning *`,
      [deal.id],
    );
    expect(edited.won_at).toBeNull();
    expect(new Date(edited.entered_stage_at).getFullYear()).toBeGreaterThan(2020);
    await asServer();
  });

  it("reopens a completed parent when an open subtask is added", async () => {
    await asUser(user);
    const milestone = (
      await one<{ id: string }>(
        `insert into milestones (user_id, title) values ($1, 'M3') returning id`,
        [user],
      )
    ).id;
    const parent = (
      await one<{ id: string }>(
        `insert into tasks (user_id, milestone_id, title, status) values ($1, $2, 'p', 'done') returning id`,
        [user, milestone],
      )
    ).id;
    await db.query(
      `insert into tasks (user_id, milestone_id, parent_task_id, title) values ($1, $2, $3, 'c')`,
      [user, milestone, parent],
    );
    const reopened = await one(`select status, completed_at from tasks where id = $1`, [parent]);
    expect(reopened).toEqual({ status: "in_progress", completed_at: null });
    await asServer();
  });

  it("deletes dependent questions together with their select field", async () => {
    await asUser(user);
    const reason = (
      await one<{ id: string }>(
        `select f.id from contact_table_fields f join contact_tables t on t.id = f.table_id
         where t.system_key = 'failed' and f.system_key = 'reason'`,
      )
    ).id;
    await db.query(`delete from contact_table_fields where id = $1`, [reason]);
    expect(
      await count(`select 1 from contact_table_fields where depends_on_field_id = $1`, [reason]),
    ).toBe(0);
    await asServer();
  });
});

describe("contacts", () => {
  let user: string;
  let other: string;

  beforeAll(async () => {
    user = await createAuthUser();
    other = await createAuthUser();
  });

  it("normalises the phone itself, whatever the client sends", async () => {
    await asUser(user);
    const contact = await one<{ id: string; phone_normalized: string }>(
      `insert into contacts (user_id, company_name, phone, phone_normalized)
       values ($1, 'Phone s.r.o.', '+420 777-123 456', 'forged') returning id, phone_normalized`,
      [user],
    );
    expect(contact.phone_normalized).toBe("420777123456");
    const updated = await one<{ phone_normalized: string | null }>(
      `update contacts set phone = '00421 905 111 222' where id = $1 returning phone_normalized`,
      [contact.id],
    );
    expect(updated.phone_normalized).toBe("421905111222");
    const cleared = await one<{ phone_normalized: string | null }>(
      `update contacts set phone = null where id = $1 returning phone_normalized`,
      [contact.id],
    );
    expect(cleared.phone_normalized).toBeNull();
    await asServer();
  });

  it("puts every new contact into unreached", async () => {
    await asUser(user);
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'New s.r.o.') returning id`,
        [user],
      )
    ).id;
    const entry = await one<{ system_key: string }>(
      `select t.system_key from contact_table_entries e join contact_tables t on t.id = e.table_id
       where e.contact_id = $1`,
      [contact],
    );
    expect(entry.system_key).toBe("unreached");
    await asServer();
  });

  it("lists contacts with their table and the latest past activity, only one's own", async () => {
    await asUser(user);
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, first_name, last_name) values ($1, 'Jan', 'Novák') returning id`,
        [user],
      )
    ).id;
    const before = await one<{ last_contact_at: string | null; search_name: string }>(
      `select last_contact_at, search_name from contact_list where id = $1`,
      [contact],
    );
    expect(before).toEqual({ last_contact_at: null, search_name: "Jan Novák" });

    await db.query(
      `insert into contact_activities (user_id, contact_id, type, occurred_at) values
         ($1, $2, 'call', '2026-01-01T10:00:00Z'),
         ($1, $2, 'email', '2026-02-01T10:00:00Z'),
         ($1, $2, 'meeting', now() + interval '1 day')`,
      [user, contact],
    );
    const after = await one<{ last_contact_at: Date; table_id: string | null }>(
      `select last_contact_at, table_id from contact_list where id = $1`,
      [contact],
    );
    expect(after.last_contact_at.toISOString()).toBe("2026-02-01T10:00:00.000Z");
    expect(after.table_id).not.toBeNull();

    await asUser(other);
    expect(await count(`select 1 from contact_list`)).toBe(0);
    await asAnon();
    await expect(db.query(`select 1 from contact_list`)).rejects.toThrow(/permission denied/);
    await asServer();
  });
});

describe("clients follow won deals", () => {
  let user: string;
  let tables: Record<string, string>;
  let stages: Record<string, string>;

  async function tableOf(contact: string) {
    const row = await one<{ system_key: string } | undefined>(
      `select t.system_key from contact_table_entries e join contact_tables t on t.id = e.table_id
       where e.contact_id = $1`,
      [contact],
    );
    return row?.system_key;
  }
  async function newContact(name: string) {
    return (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, $2) returning id`,
        [user, name],
      )
    ).id;
  }
  async function newDeal(contact: string, stage: string) {
    return (
      await one<{ id: string }>(
        `insert into deals (user_id, contact_id, stage_id, title) values ($1, $2, $3, 'Deal') returning id`,
        [user, contact, stage],
      )
    ).id;
  }

  beforeAll(async () => {
    user = await createAuthUser();
    await asUser(user);
    tables = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(`select system_key, id from contact_tables`)
      ).map((r) => [r.system_key, r.id]),
    );
    stages = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(`select system_key, id from pipeline_stages`)
      ).map((r) => [r.system_key, r.id]),
    );
    await asServer();
  });

  it("counts contacts per table, only one's own", async () => {
    await asUser(user);
    await newContact("Count A");
    await newContact("Count B");
    const counts = await rows<{ table_id: string; contacts: number }>(
      `select table_id, contacts from contact_table_counts`,
    );
    expect(counts).toEqual([{ table_id: tables.unreached, contacts: 2 }]);
    await asServer();
  });

  it("returns a contact to its previous table when its only won deal is un-won or deleted", async () => {
    await asUser(user);
    const contact = await newContact("Back s.r.o.");
    await db.query(`select move_contact($1, $2)`, [contact, tables.no_answer]);
    const deal = await newDeal(contact, stages.won);
    expect(await tableOf(contact)).toBe("clients");

    await db.query(`update deals set stage_id = $1 where id = $2`, [stages.offer, deal]);
    expect(await tableOf(contact)).toBe("no_answer");

    await db.query(`update deals set stage_id = $1 where id = $2`, [stages.won, deal]);
    const second = await newDeal(contact, stages.won);
    await db.query(`delete from deals where id = $1`, [deal]);
    expect(await tableOf(contact)).toBe("clients");
    await db.query(`delete from deals where id = $1`, [second]);
    expect(await tableOf(contact)).toBe("no_answer");
    await asServer();
  });

  it("moves a won deal's client status with its contact, and deleting a client works", async () => {
    await asUser(user);
    const first = await newContact("First");
    const next = await newContact("Next");
    const deal = await newDeal(first, stages.won);
    await db.query(`update deals set contact_id = $1 where id = $2`, [next, deal]);
    expect(await tableOf(first)).toBe("unreached");
    expect(await tableOf(next)).toBe("clients");

    await db.query(`delete from contacts where id = $1`, [next]);
    expect(await tableOf(next)).toBeUndefined();
    expect((await one(`select contact_id from deals where id = $1`, [deal])).contact_id).toBeNull();
    await asServer();
  });
});

describe("contact table editor", () => {
  let user: string;
  let tables: Record<string, string>;

  beforeAll(async () => {
    user = await createAuthUser();
    await asUser(user);
    tables = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(`select system_key, id from contact_tables`)
      ).map((r) => [r.system_key, r.id]),
    );
    await asServer();
  });

  it("removes a table, moving its contacts and recording the moves", async () => {
    await asUser(user);
    const table = (
      await one<{ id: string }>(
        `insert into contact_tables (user_id, name, position) values ($1, 'Temp', 9) returning id`,
        [user],
      )
    ).id;
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Moved') returning id`,
        [user],
      )
    ).id;
    await db.query(`select move_contact($1, $2)`, [contact, table]);

    await expect(db.query(`select remove_contact_table($1)`, [table])).rejects.toThrow(
      /target_table_required/,
    );
    await expect(
      db.query(`select remove_contact_table($1, $2)`, [table, tables.clients]),
    ).rejects.toThrow(/cannot_move_into_system_table/);
    await expect(
      db.query(`select remove_contact_table($1, $2)`, [tables.unreached, tables.follow_up]),
    ).rejects.toThrow(/system_table_readonly/);

    await db.query(`select remove_contact_table($1, $2)`, [table, tables.follow_up]);
    expect(await count(`select 1 from contact_tables where id = $1`, [table])).toBe(0);
    expect(
      (await one(`select table_id from contact_table_entries where contact_id = $1`, [contact]))
        .table_id,
    ).toBe(tables.follow_up);
    expect(
      await count(`select 1 from contact_table_moves where contact_id = $1 and to_table_id = $2`, [
        contact,
        tables.follow_up,
      ]),
    ).toBe(1);
    await asServer();
  });

  it("gives Clients no questions and checks dependencies", async () => {
    await asUser(user);
    await expect(
      db.query(
        `insert into contact_table_fields (user_id, table_id, label, type) values ($1, $2, 'Q', 'text')`,
        [user, tables.clients],
      ),
    ).rejects.toThrow(/clients_table_has_no_questions/);
    await expect(
      db.query(
        `insert into contact_table_fields (user_id, table_id, label, type, options) values ($1, $2, 'Q', 'select', '[]')`,
        [user, tables.no_answer],
      ),
    ).rejects.toThrow(/select_needs_options/);

    const parent = (
      await one<{ id: string }>(
        `insert into contact_table_fields (user_id, table_id, label, type, options)
         values ($1, $2, 'Why', 'select', '[{"key":"a","label":"A"},{"key":"b","label":"B"}]') returning id`,
        [user, tables.no_answer],
      )
    ).id;
    await expect(
      db.query(
        `insert into contact_table_fields (user_id, table_id, label, type, depends_on_field_id, depends_on_value)
         values ($1, $2, 'Other table', 'text', $3, 'a')`,
        [user, tables.follow_up, parent],
      ),
    ).rejects.toThrow(/invalid_dependency/);
    await expect(
      db.query(
        `insert into contact_table_fields (user_id, table_id, label, type, depends_on_field_id, depends_on_value)
         values ($1, $2, 'Missing option', 'text', $3, 'zzz')`,
        [user, tables.no_answer, parent],
      ),
    ).rejects.toThrow(/invalid_dependency/);
    await db.query(
      `insert into contact_table_fields (user_id, table_id, label, type, depends_on_field_id, depends_on_value)
       values ($1, $2, 'On A', 'text', $3, 'a'), ($1, $2, 'On B', 'text', $3, 'b')`,
      [user, tables.no_answer, parent],
    );

    await db.query(
      `update contact_table_fields set options = '[{"key":"a","label":"A"}]' where id = $1`,
      [parent],
    );
    const left = await rows<{ label: string }>(
      `select label from contact_table_fields where depends_on_field_id = $1`,
      [parent],
    );
    expect(left).toEqual([{ label: "On A" }]);
    await asServer();
  });
});

describe("moving a contact", () => {
  let user: string;
  let tables: Record<string, string>;
  let fields: Record<string, string>;

  async function newContact(name: string) {
    return (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, $2) returning id`,
        [user, name],
      )
    ).id;
  }

  beforeAll(async () => {
    user = await createAuthUser("cs");
    await asUser(user);
    tables = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(`select system_key, id from contact_tables`)
      ).map((r) => [r.system_key, r.id]),
    );
    const list = await rows<{ id: string; key: string }>(
      `select f.id, coalesce(f.system_key, t.system_key || ':' || coalesce(f.depends_on_value, f.label)) as key
       from contact_table_fields f join contact_tables t on t.id = f.table_id`,
    );
    fields = Object.fromEntries(list.map((r) => [r.key, r.id]));
    await asServer();
  });

  it("requires shown required answers and keeps only answers of shown questions", async () => {
    await asUser(user);
    const contact = await newContact("Answers s.r.o.");
    await expect(
      db.query(`select move_contact($1, $2, '{}')`, [contact, tables.failed]),
    ).rejects.toThrow(/answer_required/);
    await expect(
      db.query(`select move_contact($1, $2, $3)`, [
        contact,
        tables.failed,
        JSON.stringify({ [fields.reason]: "made_up" }),
      ]),
    ).rejects.toThrow(/invalid_answer/);

    const entry = await one<{ answers: Record<string, unknown> }>(
      `select * from move_contact($1, $2, $3)`,
      [
        contact,
        tables.failed,
        JSON.stringify({
          [fields.reason]: "not_interested",
          [fields["failed:not_interested"]]: "Too expensive",
          // hidden: depends on "other"
          [fields["failed:other"]]: "should be dropped",
          "not-a-field": "dropped too",
        }),
      ],
    );
    expect(entry.answers).toEqual({
      [fields.reason]: "not_interested",
      [fields["failed:not_interested"]]: "Too expensive",
    });
    await asServer();
  });

  it("checks answer types", async () => {
    await asUser(user);
    const contact = await newContact("Types s.r.o.");
    await expect(
      db.query(`select move_contact($1, $2, $3)`, [
        contact,
        tables.email_sent,
        JSON.stringify({ [fields.sent_on]: "2026-02-31" }),
      ]),
    ).rejects.toThrow(/invalid_answer/);
    await expect(
      db.query(`select move_contact($1, $2, $3)`, [
        contact,
        tables.follow_up,
        JSON.stringify({ [fields.follow_up_at]: "tomorrow" }),
      ]),
    ).rejects.toThrow(/invalid_answer/);
    await db.query(`select move_contact($1, $2, $3)`, [
      contact,
      tables.email_sent,
      JSON.stringify({ [fields.sent_on]: "2026-09-24" }),
    ]);
    await asServer();
  });

  it("logs the move as an activity and books the meeting in the calendar", async () => {
    await asUser(user);
    const contact = await newContact("Meeting s.r.o.");
    await db.query(`select move_contact($1, $2, $3)`, [
      contact,
      tables.meeting_scheduled,
      JSON.stringify({ [fields.meeting_at]: "2026-10-01T08:30:00.000Z" }),
    ]);
    const activity = await one<{ type: string; content: string }>(
      `select type, content from contact_activities where contact_id = $1`,
      [contact],
    );
    expect(activity).toEqual({ type: "move", content: "Domluvená schůzka" });
    expect(
      (
        await one<{ last_contact_at: Date | null }>(
          `select last_contact_at from contact_list where id = $1`,
          [contact],
        )
      ).last_contact_at,
    ).not.toBeNull();

    const event = await one<{ title: string; kind: string; starts_at: Date; contact_id: string }>(
      `select title, kind, starts_at, contact_id from calendar_events where contact_id = $1`,
      [contact],
    );
    expect(event.title).toBe("Meeting s.r.o.");
    expect(event.kind).toBe("meeting");
    expect(event.starts_at.toISOString()).toBe("2026-10-01T08:30:00.000Z");
    expect(
      (
        await one<{ source: string }>(`select source from calendar_events where contact_id = $1`, [
          contact,
        ])
      ).source,
    ).toBe("contact_move");

    // Deleting the booked meeting leaves the contact where it is.
    const tableBefore = (
      await one<{ table_id: string }>(
        `select table_id from contact_table_entries where contact_id = $1`,
        [contact],
      )
    ).table_id;
    await db.query(`delete from calendar_events where contact_id = $1`, [contact]);
    expect(
      (
        await one<{ table_id: string }>(
          `select table_id from contact_table_entries where contact_id = $1`,
          [contact],
        )
      ).table_id,
    ).toBe(tableBefore);
    await db.query(`select move_contact($1, $2, $3)`, [
      contact,
      tables.meeting_scheduled,
      JSON.stringify({ [fields.meeting_at]: "2026-10-01T08:30:00.000Z" }),
    ]);

    // A table without a meeting question books nothing.
    await db.query(`select move_contact($1, $2)`, [contact, tables.no_answer]);
    expect(await count(`select 1 from calendar_events where contact_id = $1`, [contact])).toBe(1);
    await asServer();
  });
});

describe("calendar events", () => {
  it("takes the new types, and only the server sets the contact-move mark", async () => {
    const user = await createAuthUser();
    await asUser(user);
    const created = await one<{ id: string; source: string; kind: string }>(
      `insert into calendar_events (user_id, title, kind, starts_at, source)
       values ($1, 'Offer due', 'deadline', now(), 'contact_move') returning id, source, kind`,
      [user],
    );
    expect(created.kind).toBe("deadline");
    expect(created.source).toBe("manual");
    await db.query(
      `update calendar_events set source = 'contact_move', kind = 'task' where id = $1`,
      [created.id],
    );
    expect(
      await one<{ source: string; kind: string }>(
        `select source, kind from calendar_events where id = $1`,
        [created.id],
      ),
    ).toEqual({ source: "manual", kind: "task" });
    await asServer();
  });
});

describe("generated contacts", () => {
  it("skips duplicates by place id, phone and name with address, and lands in unreached", async () => {
    const user = await createAuthUser();
    await asUser(user);
    await db.query(
      `insert into contacts (user_id, company_name, phone, address)
       values ($1, 'Existing Phone', '+420777123456', 'Somewhere 1'),
              ($1, 'Kavárna U Mostu', null, 'Mostní 5, Praha')`,
      [user],
    );
    const places = [
      { id: "p1", name: "New Bakery", phone: "+420 602 000 111", address: "Pekařská 1" },
      { id: "p2", name: "Same Phone", phone: "+420 777 123 456", address: "Elsewhere 2" },
      { id: "p3", name: "kavárna u mostu", phone: null, address: "MOSTNÍ 5, PRAHA" },
      { id: "p1", name: "New Bakery again", phone: null, address: "Pekařská 1" },
      { id: "p4", name: "Second New", phone: null, address: "Nová 4", website: "https://new.cz" },
      { id: "p5", name: "Over the limit", phone: null, address: "Limit 5" },
    ];
    const result = await one<{ created: number; duplicates: number }>(
      `select * from import_generated_contacts($1, 2, 'CZ')`,
      [JSON.stringify(places)],
    );
    expect(result).toEqual({ created: 2, duplicates: 3 });

    const saved = await rows<{
      company_name: string;
      source: string;
      email: string | null;
      country_code: string;
      system_key: string;
    }>(
      `select c.company_name, c.source, c.email, c.country_code, t.system_key
       from contacts c
       join contact_table_entries e on e.contact_id = c.id
       join contact_tables t on t.id = e.table_id
       where c.source = 'generated' order by c.company_name`,
    );
    expect(saved).toEqual([
      {
        company_name: "New Bakery",
        source: "generated",
        email: null,
        country_code: "CZ",
        system_key: "unreached",
      },
      {
        company_name: "Second New",
        source: "generated",
        email: null,
        country_code: "CZ",
        system_key: "unreached",
      },
    ]);
    await asAnon();
    await expect(db.query(`select * from import_generated_contacts('[]', 1)`)).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });
});

describe("prospecting status", () => {
  it("closes an idle segment when read, reports it once and never counts past the idle end", async () => {
    const user = await createAuthUser();
    await asUser(user);
    const segment = await one<{ id: string }>(`select * from start_prospecting()`);
    const running = await one<{
      running: boolean;
      idle_deadline: Date;
      idle_closed_at: Date | null;
    }>(`select * from prospecting_status('Europe/Prague')`);
    expect(running.running).toBe(true);
    expect(running.idle_closed_at).toBeNull();

    await asServer();
    await db.query(
      `update prospecting_segments set started_at = now() - interval '40 minutes' where id = $1`,
      [segment.id],
    );
    await asUser(user);
    const read = await one<{
      running: boolean;
      idle_closed_at: Date | null;
      today_seconds: number;
      segment_started_at: Date | null;
    }>(`select * from prospecting_status('UTC')`);
    expect(read.running).toBe(false);
    expect(read.segment_started_at).toBeNull();
    expect(read.idle_closed_at).not.toBeNull();
    expect(read.today_seconds).toBeLessThanOrEqual(15 * 60 + 1);

    const stored = await one<{ end_reason: string; minutes: number }>(
      `select end_reason, extract(epoch from ended_at - started_at) / 60 as minutes
       from prospecting_segments where id = $1`,
      [segment.id],
    );
    expect(stored.end_reason).toBe("idle");
    expect(Math.round(Number(stored.minutes))).toBe(15);

    const again = await one<{ idle_closed_at: Date | null }>(
      `select * from prospecting_status('UTC')`,
    );
    expect(again.idle_closed_at).toBeNull();
    await asServer();
  });
});

describe("cold calling statistics", () => {
  it("splits time across days in the user's zone and counts meetings per day", async () => {
    const user = await createAuthUser();
    await asServer();
    // 23:30–00:30 Prague time on the night of 10 to 11 September 2026 (UTC+2).
    await db.query(
      `insert into prospecting_segments (user_id, started_at, ended_at, end_reason)
       values ($1, '2026-09-10T21:30:00Z', '2026-09-10T22:30:00Z', 'pause')`,
      [user],
    );
    const tables = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(
          `select system_key, id from contact_tables where user_id = $1`,
          [user],
        )
      ).map((r) => [r.system_key, r.id]),
    );
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Stats') returning id`,
        [user],
      )
    ).id;
    await db.query(
      `insert into contact_table_moves (user_id, contact_id, from_table_id, to_table_id, created_at) values
         ($1, $2, $3, $4, '2026-09-10T21:45:00Z'),
         ($1, $2, $3, $4, '2026-09-10T22:15:00Z'),
         ($1, $2, $3, $5, '2026-09-10T22:20:00Z')`,
      [user, contact, tables.unreached, tables.meeting_scheduled, tables.no_answer],
    );

    await asUser(user);
    const seconds = await rows<{ day: Date; seconds: number }>(
      `select day::text as day, seconds from prospecting_daily_seconds('2026-09-09', '2026-09-11', 'Europe/Prague')`,
    );
    expect(seconds).toEqual([
      { day: "2026-09-09", seconds: 0 },
      { day: "2026-09-10", seconds: 1800 },
      { day: "2026-09-11", seconds: 1800 },
    ]);
    const meetings = await rows<{ day: string; meetings: number }>(
      `select day::text as day, meetings from meetings_daily('2026-09-01', '2026-09-30', 'Europe/Prague')`,
    );
    expect(meetings).toEqual([
      { day: "2026-09-10", meetings: 1 },
      { day: "2026-09-11", meetings: 1 },
    ]);

    await asUser(second);
    expect(
      await count(`select 1 from meetings_daily('2026-09-01', '2026-09-30', 'Europe/Prague')`),
    ).toBe(0);
    await asServer();
  });
});

describe("call time statistics", () => {
  it("rebuilds from every account's moves, caps one account at 30 an hour, keeps no user", async () => {
    await asServer();
    const caller = await createAuthUser();
    await db.query(
      `update user_settings set timezone = 'Europe/Prague', country_code = 'SK' where user_id = $1`,
      [caller],
    );
    const tables = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(
          `select system_key, id from contact_tables where user_id = $1`,
          [caller],
        )
      ).map((r) => [r.system_key, r.id]),
    );
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Call') returning id`,
        [caller],
      )
    ).id;
    // Tuesday 22 September 2026, 08:xx UTC = 10:xx in Prague: 40 attempts, 3 meetings.
    await db.query(
      `insert into contact_table_moves (user_id, contact_id, from_table_id, to_table_id, created_at)
       select $1, $2, $3, case when g <= 3 then $4::uuid else $5::uuid end,
              '2026-09-22T08:00:00Z'::timestamptz + g * interval '1 minute'
       from generate_series(1, 40) g`,
      [caller, contact, tables.unreached, tables.meeting_scheduled, tables.no_answer],
    );
    // A move that is not a call (between other tables) does not count.
    await db.query(
      `insert into contact_table_moves (user_id, contact_id, from_table_id, to_table_id, created_at)
       values ($1, $2, $3, $4, '2026-09-22T09:00:00Z')`,
      [caller, contact, tables.follow_up, tables.meeting_scheduled],
    );

    await asUser(caller);
    await expect(db.query(`select refresh_call_time_stats()`)).rejects.toThrow(/permission denied/);
    await asServer();
    await db.query(`select refresh_call_time_stats()`);

    const stats = await rows(
      `select country_code, day_of_week, hour, attempts, meetings from call_time_stats where country_code = 'SK'`,
    );
    expect(stats).toEqual([
      { country_code: "SK", day_of_week: 2, hour: 10, attempts: 30, meetings: 3 },
    ]);
    const columns = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'call_time_stats' and column_name like '%user%'`,
    );
    expect(columns).toEqual([]);

    await asUser(second);
    expect(await count(`select 1 from call_time_stats where country_code = 'SK'`)).toBe(1);
    await asServer();
  });
});

describe("industry insights", () => {
  it("unlocks itself at 10 meetings and then shares meetings by industry", async () => {
    const user = await createAuthUser();
    await asUser(user);
    await db.query(`select * from import_generated_contacts($1, 10, 'CZ', 'Kadeřnictví')`, [
      JSON.stringify(
        Array.from({ length: 6 }, (_, i) => ({
          id: `h${i}`,
          name: `Salon ${i}`,
          address: `A ${i}`,
        })),
      ),
    ]);
    await db.query(`select * from import_generated_contacts($1, 10, 'CZ', 'kadeřnictví ')`, [
      JSON.stringify([{ id: "h9", name: "Salon 9", address: "A 9" }]),
    ]);
    await db.query(`select * from import_generated_contacts($1, 10, 'CZ', 'Zubař')`, [
      JSON.stringify(
        Array.from({ length: 5 }, (_, i) => ({
          id: `z${i}`,
          name: `Zubař ${i}`,
          address: `Z ${i}`,
        })),
      ),
    ]);
    const tables = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(`select system_key, id from contact_tables`)
      ).map((r) => [r.system_key, r.id]),
    );
    const meetingAt = (
      await one<{ id: string }>(
        `select id from contact_table_fields where table_id = $1 and system_key = 'meeting_at'`,
        [tables.meeting_scheduled],
      )
    ).id;
    const contacts = await rows<{ id: string; name: string }>(
      `select id, company_name as name from contacts order by company_name`,
    );
    const moveTo = (id: string, table: string, answers = {}) =>
      db.query(`select move_contact($1, $2, $3)`, [id, table, JSON.stringify(answers)]);
    const meeting = { [meetingAt]: "2026-10-01T08:00:00Z" };

    // Salons: 4 called, 3 meetings. Dentists: 5 called, 1 meeting.
    for (const c of contacts.filter((c) => c.name.startsWith("Salon")).slice(0, 4)) {
      await moveTo(c.id, tables.no_answer);
    }
    const salons = contacts.filter((c) => c.name.startsWith("Salon"));
    for (const c of salons.slice(0, 3)) await moveTo(c.id, tables.meeting_scheduled, meeting);
    const dentists = contacts.filter((c) => c.name.startsWith("Zubař"));
    for (const c of dentists) await moveTo(c.id, tables.no_answer);
    await moveTo(dentists[0].id, tables.meeting_scheduled, meeting);

    const locked = await one<{ i: Record<string, unknown> }>(`select industry_insights() as i`);
    expect(locked.i).toMatchObject({ meetings: 4, needed: 10, unlocked_at: null, industries: [] });
    await expect(
      db.query(`insert into unlocks (user_id, key) values ($1, 'best_industries')`, [user]),
    ).rejects.toThrow(/row-level security/);

    // Six more meetings (moving back and forth counts each booking).
    for (let i = 0; i < 6; i++) {
      await moveTo(dentists[1].id, tables.no_answer);
      await moveTo(dentists[1].id, tables.meeting_scheduled, meeting);
    }
    const open = await one<{ i: { unlocked_at: string | null; industries: unknown[] } }>(
      `select industry_insights() as i`,
    );
    expect(open.i.unlocked_at).not.toBeNull();
    expect(open.i.industries).toEqual([
      { industry: "Kadeřnictví", contacts: 7, called: 4, meetings: 3 },
      { industry: "Zubař", contacts: 5, called: 5, meetings: 2 },
    ]);
    expect(await count(`select 1 from unlocks where key = 'best_industries'`)).toBe(1);
    await asServer();
  });
});

describe("finance", () => {
  let user: string;
  let stages: Record<string, string>;

  const income = (deal: string) =>
    rows<{ source: string; amount: string; needs_review: boolean }>(
      `select source, amount::text, needs_review from transactions
       where deal_id = '${deal}' order by source`,
    );
  async function newDeal(stage: string, value: number | null = 10000) {
    return (
      await one<{ id: string }>(
        `insert into deals (user_id, stage_id, title, value) values ('${user}', '${stage}', 'Web', ${value ?? "null"}) returning id`,
      )
    ).id;
  }

  beforeAll(async () => {
    user = await createAuthUser();
    await asUser(user);
    stages = Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(
          `select system_key, id from pipeline_stages where user_id = '${user}'`,
        )
      ).map((r) => [r.system_key, r.id]),
    );
  });
  afterAll(asServer);

  it("books a deposit share on entering the deposit stage, then only the rest on winning", async () => {
    const deal = await newDeal(stages.lead);
    await db.query(`update deals set stage_id = '${stages.deposit_paid}' where id = '${deal}'`);
    expect(await income(deal)).toEqual([
      { source: "deal_deposit", amount: "3000.00", needs_review: false },
    ]);
    await db.query(`update deals set stage_id = '${stages.won}' where id = '${deal}'`);
    expect((await income(deal)).map((r) => [r.source, r.amount])).toEqual([
      ["deal_deposit", "3000.00"],
      ["deal_invoice", "7000.00"],
    ]);
  });

  it("marks income for review when a deal moves back, never deletes or doubles it", async () => {
    const deal = await newDeal(stages.lead);
    await db.query(`update deals set stage_id = '${stages.won}' where id = '${deal}'`);
    await db.query(`update deals set stage_id = '${stages.offer}' where id = '${deal}'`);
    expect(await income(deal)).toEqual([
      { source: "deal_invoice", amount: "10000.00", needs_review: true },
    ]);
    await db.query(`update deals set stage_id = '${stages.won}' where id = '${deal}'`);
    expect(await income(deal)).toHaveLength(1);
  });

  it("books nothing for a deal without a value", async () => {
    const deal = await newDeal(stages.lead, null);
    await db.query(`update deals set stage_id = '${stages.won}' where id = '${deal}'`);
    expect(await income(deal)).toEqual([]);
  });

  it("keeps the source to the server and lets the owner only clear the review mark", async () => {
    const created = await one<{ id: string; source: string; needs_review: boolean }>(
      `insert into transactions (user_id, type, amount, occurred_on, source, needs_review)
       values ('${user}', 'expense', 50, '2026-09-01', 'deal_invoice', true)
       returning id, source, needs_review`,
    );
    expect(created).toMatchObject({ source: "manual", needs_review: false });
    const deal = await newDeal(stages.won);
    const flagged = (await income(deal))[0];
    expect(flagged.needs_review).toBe(false);
    await db.query(`update transactions set needs_review = true where deal_id = '${deal}'`);
    expect((await income(deal))[0].needs_review).toBe(false);
  });

  it("moves the deposit marker to one stage and recomputes from its percent", async () => {
    await db.query(`select set_deposit_stage('${stages.offer}', 50::smallint)`);
    expect(await count(`select 1 from pipeline_stages where system_key = 'deposit_paid'`)).toBe(1);
    const deal = await newDeal(stages.lead);
    await db.query(`update deals set stage_id = '${stages.offer}' where id = '${deal}'`);
    expect((await income(deal))[0].amount).toBe("5000.00");
    await expect(db.query(`select set_deposit_stage('${stages.won}')`)).rejects.toThrow(
      /stage_not_found/,
    );
    await db.query(`select set_deposit_stage(null)`);
    expect(await count(`select 1 from pipeline_stages where system_key = 'deposit_paid'`)).toBe(0);
  });

  it("books recurring payments once per due day, catching up and stopping at the end", async () => {
    await db.query(
      `insert into recurring_payments (user_id, type, amount, description, frequency, next_due_on, due_day, ends_on)
       values ('${user}', 'expense', 500, 'Hosting', 'monthly', current_date - 65, 31,
               current_date - 5)`,
    );
    await asServer();
    const first = (await one<{ n: number }>(`select post_due_recurring_payments() as n`)).n;
    expect(first).toBeGreaterThanOrEqual(2);
    expect((await one<{ n: number }>(`select post_due_recurring_payments() as n`)).n).toBe(0);
    const payment = await one<{ is_active: boolean; next_due_on: string }>(
      `select is_active, next_due_on::text from recurring_payments where user_id = '${user}'`,
    );
    expect(payment.is_active).toBe(false);
    expect(
      await count(`select 1 from transactions where user_id = '${user}' and source = 'recurring'`),
    ).toBe(first);
    await asUser(user);
  });

  it("clamps monthly due days to the end of shorter months without drifting", async () => {
    const next = async (from: string, freq: string, day: number | null) =>
      (
        await one<{ d: string }>(
          `select recurring_next_due('${from}', '${freq}', ${day ?? "null"}::smallint)::text as d`,
        )
      ).d;
    expect(await next("2026-01-31", "monthly", 31)).toBe("2026-02-28");
    expect(await next("2026-02-28", "monthly", 31)).toBe("2026-03-31");
    expect(await next("2026-11-30", "quarterly", null)).toBe("2027-02-28");
    expect(await next("2026-09-25", "weekly", null)).toBe("2026-10-02");
    expect(await next("2026-09-25", "yearly", null)).toBe("2027-09-25");
  });

  it("creates one numbered invoice per deal in a tap and books its payment once", async () => {
    const deal = await newDeal(stages.lead, 2500);
    const invoice = await one<{ id: string; number: string; amount: string; status: string }>(
      `select * from create_invoice_from_deal('${deal}')`,
    );
    expect(invoice).toMatchObject({ amount: "2500.00", status: "open" });
    expect(invoice.number).toMatch(/^\d{4}-\d{3}$/);
    const again = await one<{ id: string }>(`select * from create_invoice_from_deal('${deal}')`);
    expect(again.id).toBe(invoice.id);
    await db.query(`select mark_invoice_paid('${invoice.id}')`);
    await db.query(`select mark_invoice_paid('${invoice.id}')`);
    expect(await income(deal)).toEqual([
      { source: "invoice", amount: "2500.00", needs_review: false },
    ]);
    await db.query(`update deals set stage_id = '${stages.won}' where id = '${deal}'`);
    expect(await income(deal)).toHaveLength(1);
    const noValue = await newDeal(stages.lead, null);
    await expect(db.query(`select create_invoice_from_deal('${noValue}')`)).rejects.toThrow(
      /deal_value_required/,
    );
  });

  it("does not run the recurring job for clients and totals only the caller's rows", async () => {
    await expect(db.query(`select post_due_recurring_payments()`)).rejects.toThrow(
      /permission denied/,
    );
    const totals = await one<{ income: string; expense: string }>(
      `select * from finance_totals(current_date - 400, current_date + 1)`,
    );
    expect(Number(totals.income)).toBeGreaterThan(0);
    await asServer();
    const other = await createAuthUser();
    await asUser(other);
    const none = await one<{ income: string; expense: string }>(
      `select * from finance_totals(current_date - 400, current_date + 1)`,
    );
    expect(none).toEqual({ income: "0", expense: "0" });
    expect(
      await count(
        `select 1 from finance_monthly_totals((date_trunc('month', current_date) - interval '11 months')::date, current_date)`,
      ),
    ).toBe(12);
    await asUser(user);
  });
});

describe("meeting surveys", () => {
  it("keeps to their owner, holds a small answers object and only for the owner's deals", async () => {
    const owner = await createAuthUser();
    const other = await createAuthUser();
    await asUser(owner);
    const stage = await one<{ id: string }>(
      `select id from pipeline_stages where user_id = '${owner}' and system_key = 'meeting'`,
    );
    const deal = await one<{ id: string }>(
      `insert into deals (user_id, stage_id, title) values ('${owner}', '${stage.id}', 'Web') returning id`,
    );
    await db.query(
      `insert into meeting_surveys (user_id, deal_id, stage_id, answers)
       values ('${owner}', '${deal.id}', '${stage.id}', '{"mood": 4, "nextStep": "sendOffer"}')`,
    );
    expect(await count(`select 1 from meeting_surveys`)).toBe(1);

    // An answers value that is not an object, or is far bigger than any survey, is refused.
    await expect(
      db.query(
        `insert into meeting_surveys (user_id, deal_id, answers) values ('${owner}', '${deal.id}', '[1]')`,
      ),
    ).rejects.toThrow(/meeting_surveys_answers_shape/);
    await expect(
      db.query(
        `insert into meeting_surveys (user_id, deal_id, answers)
         values ('${owner}', '${deal.id}', jsonb_build_object('notes', repeat('x', 20000)))`,
      ),
    ).rejects.toThrow(/meeting_surveys_answers_shape/);

    await asUser(other);
    expect(await count(`select 1 from meeting_surveys`)).toBe(0);
    // Not for somebody else's deal, and not as somebody else.
    await expect(
      db.query(
        `insert into meeting_surveys (user_id, deal_id, answers) values ('${other}', '${deal.id}', '{}')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into meeting_surveys (user_id, deal_id, answers) values ('${owner}', '${deal.id}', '{}')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await asServer();
  });
});

describe("audit: moveContact, milestone progress and daily timer totals", () => {
  beforeEach(async () => {
    await asServer();
  });

  async function systemTables(user: string) {
    return Object.fromEntries(
      (
        await rows<{ system_key: string; id: string }>(
          `select system_key, id from contact_tables where user_id = $1`,
          [user],
        )
      ).map((r) => [r.system_key, r.id]),
    );
  }

  it("moves a contact back and forth, one entry at a time, only within one's own data", async () => {
    const user = await createAuthUser();
    const tables = await systemTables(user);
    await asUser(user);
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Chain s.r.o.') returning id`,
        [user],
      )
    ).id;
    for (const table of [tables.no_answer, tables.unreached, tables.no_answer]) {
      await db.query(`select move_contact($1, $2)`, [contact, table]);
      // Moves are ordered by created_at; keep two of them from sharing a microsecond.
      await db.query(`select pg_sleep(0.002)`);
      expect(
        await count(`select 1 from contact_table_entries where contact_id = $1`, [contact]),
      ).toBe(1);
    }
    const moves = await rows<{ from_table_id: string | null; to_table_id: string }>(
      `select from_table_id, to_table_id from contact_table_moves
       where contact_id = $1 and from_table_id is not null order by created_at, id`,
      [contact],
    );
    expect(moves).toEqual([
      { from_table_id: tables.unreached, to_table_id: tables.no_answer },
      { from_table_id: tables.no_answer, to_table_id: tables.unreached },
      { from_table_id: tables.unreached, to_table_id: tables.no_answer },
    ]);
    expect(
      (
        await one<{ table_id: string }>(
          `select table_id from contact_table_entries where contact_id = $1`,
          [contact],
        )
      ).table_id,
    ).toBe(tables.no_answer);

    // Someone else can neither move this contact nor move their own into this user's table.
    await asServer();
    const stranger = await createAuthUser();
    await asUser(stranger);
    const theirs = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Theirs') returning id`,
        [stranger],
      )
    ).id;
    const strangerTables = await systemTables(stranger);
    await expect(
      db.query(`select move_contact($1, $2)`, [contact, strangerTables.no_answer]),
    ).rejects.toThrow(/contact_not_found/);
    await expect(
      db.query(`select move_contact($1, $2)`, [theirs, tables.no_answer]),
    ).rejects.toThrow(/contact_table_not_found/);
    await asServer();
  });

  it("computes milestone progress from every task at any depth, following reopening", async () => {
    const user = await createAuthUser();
    await asUser(user);
    const milestone = (
      await one<{ id: string }>(
        `insert into milestones (user_id, title) values ($1, 'Deep') returning id`,
        [user],
      )
    ).id;
    const insert = async (title: string, parent: string | null) =>
      (
        await one<{ id: string }>(
          `insert into tasks (user_id, milestone_id, parent_task_id, title)
           values ($1, $2, $3, $4) returning id`,
          [user, milestone, parent, title],
        )
      ).id;
    const root = await insert("root", null);
    const mid = await insert("mid", root);
    const leaf = await insert("leaf", mid);
    const progress = () =>
      one<{ total: number; done: number }>(
        `select total, done from milestone_task_counts where milestone_id = $1`,
        [milestone],
      );

    expect(await progress()).toEqual({ total: 3, done: 0 });
    await db.query(`update tasks set status = 'done' where id = $1`, [leaf]);
    // The unlocked parents stay open until ticked by hand.
    expect(await progress()).toEqual({ total: 3, done: 1 });
    await db.query(`update tasks set status = 'done' where id = $1`, [mid]);
    await db.query(`update tasks set status = 'done' where id = $1`, [root]);
    expect(await progress()).toEqual({ total: 3, done: 3 });
    expect(
      (await one<{ status: string }>(`select status from milestones where id = $1`, [milestone]))
        .status,
    ).toBe("active");

    await db.query(`update tasks set status = 'todo' where id = $1`, [leaf]);
    expect(await progress()).toEqual({ total: 3, done: 0 });
    await asServer();
  });

  /**
   * A whole-hour zone whose midnight is the start of an hour 20–80 minutes ago, so a
   * segment can be placed across midnight independently of when the test runs.
   */
  async function zoneWithRecentMidnight() {
    const { boundary, hour } = await one<{ boundary: Date; hour: number }>(
      `select b as boundary, extract(hour from b at time zone 'UTC')::int as hour
       from (
         select date_trunc('hour', now(), 'UTC')
           - case when now() - date_trunc('hour', now(), 'UTC') < interval '20 minutes'
               then interval '1 hour' else interval '0' end as b
       ) q`,
    );
    let offset = (24 - hour) % 24;
    if (offset > 14) offset -= 24;
    // Etc/GMT names carry the inverted sign: Etc/GMT-2 is UTC+2.
    const zone = offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
    const { today, yesterday } = await one<{ today: string; yesterday: string }>(
      `select (($1::timestamptz) at time zone $2)::date::text as today,
              ((($1::timestamptz) at time zone $2)::date - 1)::text as yesterday`,
      [boundary.toISOString(), zone],
    );
    return { boundary, zone, today, yesterday };
  }

  it("splits an open segment at midnight in the user's zone and stops it 15 idle minutes on", async () => {
    const user = await createAuthUser();
    const tables = await systemTables(user);
    const { boundary, zone, today, yesterday } = await zoneWithRecentMidnight();
    const midnight = boundary.toISOString();

    await asServer();
    const contact = (
      await one<{ id: string }>(
        `insert into contacts (user_id, company_name) values ($1, 'Night') returning id`,
        [user],
      )
    ).id;
    // Started 20 minutes before midnight, still open; the last move out of Unreached
    // was 10 minutes before midnight, so the segment really ended 5 minutes after it.
    const segment = (
      await one<{ id: string }>(
        `insert into prospecting_segments (user_id, actor_id, started_at)
         values ($1, $1, $2::timestamptz - interval '20 minutes') returning id`,
        [user, midnight],
      )
    ).id;
    await db.query(
      `insert into contact_table_moves (user_id, actor_id, contact_id, from_table_id, to_table_id, created_at)
       values ($1, $1, $2, $3, $4, $5::timestamptz - interval '10 minutes')`,
      [user, contact, tables.unreached, tables.no_answer, midnight],
    );

    await asUser(user);
    const day = async (date: string) =>
      (await one<{ s: number }>(`select prospecting_seconds_for_day($1, $2) as s`, [date, zone])).s;
    expect(await day(yesterday)).toBe(20 * 60);
    // The new day starts at zero by itself; only the 5 minutes after midnight count.
    expect(await day(today)).toBe(5 * 60);
    expect(
      await rows(`select day::text as day, seconds from prospecting_daily_seconds($1, $2, $3)`, [
        yesterday,
        today,
        zone,
      ]),
    ).toEqual([
      { day: yesterday, seconds: 20 * 60 },
      { day: today, seconds: 5 * 60 },
    ]);

    // Reading closes it at the idle end; nothing changes in the totals.
    const status = await one<{ running: boolean; today_seconds: number; idle_closed_at: Date }>(
      `select * from prospecting_status($1)`,
      [zone],
    );
    expect(status.running).toBe(false);
    expect(status.today_seconds).toBe(5 * 60);
    expect(status.idle_closed_at.getTime()).toBe(boundary.getTime() + 5 * 60_000);
    await asServer();
    expect(
      (
        await one<{ end_reason: string }>(
          `select end_reason from prospecting_segments where id = $1`,
          [segment],
        )
      ).end_reason,
    ).toBe("idle");
  });

  it("keeps running while contacts leave Unreached, and only those moves count as activity", async () => {
    const user = await createAuthUser();
    const tables = await systemTables(user);
    await asServer();
    const [first, second] = await rows<{ id: string }>(
      `insert into contacts (user_id, company_name) values ($1, 'One'), ($1, 'Two') returning id`,
      [user],
    );
    await db.query(
      `insert into prospecting_segments (user_id, started_at) values ($1, now() - interval '40 minutes')`,
      [user],
    );
    await db.query(
      `insert into contact_table_moves (user_id, contact_id, from_table_id, to_table_id, created_at)
       values ($1, $2, $3, $4, now() - interval '30 minutes')`,
      [user, first.id, tables.unreached, tables.no_answer],
    );
    // A move between two other tables is not prospecting activity.
    await db.query(
      `insert into contact_table_moves (user_id, contact_id, from_table_id, to_table_id, created_at)
       values ($1, $2, $3, $4, now() - interval '5 minutes')`,
      [user, first.id, tables.no_answer, tables.unreached],
    );

    await asUser(user);
    // 30 minutes since the last real activity: the segment is already over.
    const idle = await one<{ idle_deadline: Date | null; running: boolean }>(
      `select * from prospecting_status('UTC')`,
    );
    expect(idle.running).toBe(false);

    // A fresh start, and a move out of Unreached through move_contact pushes the deadline.
    await db.query(`select * from start_prospecting()`);
    await db.query(`select move_contact($1, $2)`, [second.id, tables.no_answer]);
    const running = await one<{ running: boolean; idle_deadline: Date; server_now: Date }>(
      `select * from prospecting_status('UTC')`,
    );
    expect(running.running).toBe(true);
    const ahead = running.idle_deadline.getTime() - running.server_now.getTime();
    expect(Math.abs(ahead - 15 * 60_000)).toBeLessThan(5_000);

    // The idle segment counted 15 minutes after its last activity, i.e. 25 in total.
    const total = (
      await one<{ s: number }>(
        `select sum(seconds)::int as s
         from prospecting_daily_seconds(current_date - 1, current_date + 1, 'UTC')`,
      )
    ).s;
    expect(Math.abs(total - 25 * 60)).toBeLessThan(5);
    await db.query(`select * from pause_prospecting()`);
    await asServer();
  });
});

describe("jarvis", () => {
  it("keeps conversations to their owner and messages and usage to the server", async () => {
    const user = await createAuthUser();
    const other = await createAuthUser();

    await asUser(user);
    const conversation = await one<{ id: string }>(
      `insert into jarvis_conversations (user_id, title) values ('${user}', 'Plan') returning id`,
    );
    // Messages and usage are written only by /api/jarvis through the admin client.
    await expect(
      db.query(
        `insert into jarvis_messages (user_id, conversation_id, role, content)
         values ('${user}', '${conversation.id}', 'assistant', 'forged')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.query(
        `insert into ai_usage (user_id, purpose, model) values ('${user}', 'chat', 'claude-sonnet-5')`,
      ),
    ).rejects.toThrow(/row-level security/);

    await asServer();
    await db.query(
      `insert into jarvis_messages (user_id, conversation_id, role, content, model)
       values ('${user}', '${conversation.id}', 'user', 'hi', null),
              ('${user}', '${conversation.id}', 'assistant', 'hello', 'claude-sonnet-5')`,
    );
    await db.query(
      `insert into ai_usage (user_id, conversation_id, purpose, model, input_tokens, output_tokens, cost_usd)
       values ('${user}', '${conversation.id}', 'chat', 'claude-sonnet-5', 1000, 100, 0.003)`,
    );
    // The usage row points at the owner's conversation only.
    await expect(
      db.query(
        `insert into ai_usage (user_id, conversation_id, purpose, model)
         values ('${other}', '${conversation.id}', 'chat', 'claude-sonnet-5')`,
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query(
        `insert into ai_usage (user_id, purpose, model, cost_usd) values ('${user}', 'chat', 'x', -1)`,
      ),
    ).rejects.toThrow(/check/);

    await asUser(user);
    expect(await count(`select 1 from jarvis_messages`)).toBe(2);
    expect(await count(`select 1 from ai_usage`)).toBe(0);
    // Reading and deleting own history is allowed; editing an answer is not.
    await db.query(`update jarvis_messages set content = 'edited' where role = 'assistant'`);
    expect(
      (
        await one<{ content: string }>(
          `select content from jarvis_messages where role = 'assistant'`,
        )
      ).content,
    ).toBe("hello");

    await asUser(other);
    expect(await count(`select 1 from jarvis_conversations`)).toBe(0);
    expect(await count(`select 1 from jarvis_messages`)).toBe(0);
    await expect(
      db.query(`insert into jarvis_conversations (user_id, title) values ('${user}', 'Not mine')`),
    ).rejects.toThrow(/row-level security/);

    await asUser(user);
    await db.query(`delete from jarvis_conversations where id = '${conversation.id}'`);
    await asServer();
    expect(await count(`select 1 from jarvis_messages where user_id = $1`, [user])).toBe(0);
    // Usage outlives the conversation, detached from it.
    expect(
      (await one(
        `select conversation_id, cost_usd::float as cost from ai_usage where user_id = $1`,
        [user],
      )) as Row,
    ).toEqual({ conversation_id: null, cost: 0.003 });
  });
});

describe("jarvis extensions", () => {
  it("lets the client only mark its own suggestions seen or dismissed", async () => {
    const user = await createAuthUser();
    const other = await createAuthUser();

    await asUser(user);
    await expect(
      db.query(
        `insert into jarvis_suggestions (user_id, type, text) values ('${user}', 'insight', 'forged')`,
      ),
    ).rejects.toThrow(/row-level security/);

    await asServer();
    const suggestion = await one<{ id: string }>(
      `insert into jarvis_suggestions (user_id, type, text, action, dedupe_key)
       values ($1, 'stalledDeal', 'Deal stuck', '{"kind":"open","href":"/app/pipeline"}', 'stalledDeal:x')
       returning id`,
      [user],
    );
    // One suggestion per event.
    await expect(
      db.query(
        `insert into jarvis_suggestions (user_id, type, text, dedupe_key) values ($1, 'stalledDeal', 'again', 'stalledDeal:x')`,
        [user],
      ),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      db.query(
        `insert into jarvis_suggestions (user_id, type, text) values ($1, 'nonsense', 'x')`,
        [user],
      ),
    ).rejects.toThrow(/check/);

    await asUser(user);
    await db.query(`update jarvis_suggestions set seen_at = now(), dismissed_at = now()`);
    await expect(
      db.query(`update jarvis_suggestions set action = '{"kind":"open","href":"https://evil"}'`),
    ).rejects.toThrow(/jarvis_suggestions_are_server_only/);
    await expect(db.query(`update jarvis_suggestions set text = 'edited'`)).rejects.toThrow(
      /jarvis_suggestions_are_server_only/,
    );
    await db.query(`delete from jarvis_suggestions`);
    await asServer();
    const row = await one<{ seen: boolean; dismissed: boolean }>(
      `select seen_at is not null as seen, dismissed_at is not null as dismissed from jarvis_suggestions where id = $1`,
      [suggestion.id],
    );
    expect(row).toEqual({ seen: true, dismissed: true });

    await asUser(other);
    expect(await count(`select 1 from jarvis_suggestions`)).toBe(0);
    await db.query(`update jarvis_suggestions set dismissed_at = null`);
    await asServer();
    expect(
      await count(`select 1 from jarvis_suggestions where id = $1 and dismissed_at is not null`, [
        suggestion.id,
      ]),
    ).toBe(1);
  });

  it("keeps the watch state and its candidate list on the server", async () => {
    const user = await createAuthUser();
    await asServer();
    await one(`insert into milestones (user_id, title) values ($1, 'Fresh') returning id`, [user]);

    await asUser(user);
    await expect(
      db.query(`insert into jarvis_watch_state (user_id, last_run_at) values ('${user}', now())`),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.query(`select * from jarvis_watch_candidates(now() - interval '1 day', 10)`),
    ).rejects.toThrow(/permission denied/);

    await asServer();
    const before = await rows<{ user_id: string }>(
      `select user_id from jarvis_watch_candidates(now() - interval '1 day', 1000)`,
    );
    expect(before.map((r) => r.user_id)).toContain(user);
    // A user scanned just now goes to the back of the queue.
    await db.query(`insert into jarvis_watch_state (user_id, last_run_at) values ($1, now())`, [
      user,
    ]);
    const after = await rows<{ user_id: string }>(
      `select user_id from jarvis_watch_candidates(now() - interval '1 day', 1000)`,
    );
    expect(after.at(-1)?.user_id).toBe(user);
    expect(
      await count(`select 1 from jarvis_watch_candidates(now() + interval '1 day', 1000)`),
    ).toBe(0);
  });

  it("records attachments only from the server, inside the owner's folder", async () => {
    const user = await createAuthUser();
    const other = await createAuthUser();
    const values = (owner: string, path: string) => [owner, path];
    const insert = `insert into attachments (user_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes, extracted_text)
       values ($1, 'jarvis_message', gen_random_uuid(), $2, 'a.pdf', 'application/pdf', 10, 'Hello')`;

    await asUser(user);
    await expect(db.query(insert, values(user, `${user}/jarvis/a`))).rejects.toThrow(
      /row-level security/,
    );

    await asServer();
    await db.query(insert, values(user, `${user}/jarvis/a`));
    await expect(db.query(insert, values(user, `${other}/jarvis/b`))).rejects.toThrow(
      /attachments_storage_path_owner/,
    );

    await asUser(user);
    expect(await count(`select 1 from attachments`)).toBe(1);
    await db.query(`update attachments set mime_type = 'image/png'`);
    await asServer();
    expect(
      (
        await one<{ mime_type: string }>(`select mime_type from attachments where user_id = $1`, [
          user,
        ])
      ).mime_type,
    ).toBe("application/pdf");

    await asUser(other);
    expect(await count(`select 1 from attachments`)).toBe(0);
    await asUser(user);
    await db.query(`delete from attachments`);
    expect(await count(`select 1 from attachments`)).toBe(0);
    await asServer();
  });
});

describe("phones in E.164", () => {
  const MIGRATION = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_phones_e164.sql"))!;

  it("reads stored numbers in the contact's or the owner's country", async () => {
    const cases: [string, string | null, string | null][] = [
      ["777 123 456", "CZ", "+420777123456"],
      ["+420 777-123 456", "CZ", "+420777123456"],
      ["00421 905 111 222", "CZ", "+421905111222"],
      ["0905 111 222", "SK", "+421905111222"],
      ["06 1234 5678", "IT", "+390612345678"],
      ["1 (213) 373-4253", "US", "+12133734253"],
      ["777123456", null, "+420777123456"],
      ["call me", "CZ", null],
      ["777 123 456 ext. 12", "CZ", null],
      ["12 34", "CZ", null],
      ["+0 123 456 789", "CZ", null],
    ];
    for (const [phone, country, expected] of cases) {
      const { e164 } = await one<{ e164: string | null }>(`select phone_to_e164($1, $2) as e164`, [
        phone,
        country,
      ]);
      expect(e164, `${phone} in ${country}`).toBe(expected);
    }
  });

  it("converts saved phones and leaves the unrecognised ones as they were", async () => {
    const user = await createAuthUser();
    await asServer();
    await db.query(`update user_settings set country_code = 'SK' where user_id = $1`, [user]);
    const inserted = await rows<{ id: string; company_name: string }>(
      `insert into contacts (user_id, company_name, phone, country_code)
       values ($1, 'National', '0905 111 222', null),
              ($1, 'Czech', '777 123 456', 'CZ'),
              ($1, 'Junk', 'ask reception', null),
              ($1, 'Done', '+420602000111', null)
       returning id, company_name`,
      [user],
    );
    const { id: worker } = await one<{ id: string }>(
      `insert into workers (owner_id, name, phone) values ($1, 'Eva', '0905 222 333') returning id`,
      [user],
    );

    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), "utf8"));

    const saved = await rows<{ company_name: string; phone: string; phone_normalized: string }>(
      `select company_name, phone, phone_normalized from contacts where id = any($1) order by company_name`,
      [inserted.map((c) => c.id)],
    );
    expect(saved).toEqual([
      { company_name: "Czech", phone: "+420777123456", phone_normalized: "420777123456" },
      { company_name: "Done", phone: "+420602000111", phone_normalized: "420602000111" },
      { company_name: "Junk", phone: "ask reception", phone_normalized: null },
      { company_name: "National", phone: "+421905111222", phone_normalized: "421905111222" },
    ]);
    expect((await one(`select phone from workers where id = $1`, [worker])).phone).toBe(
      "+421905222333",
    );
  });

  it("matches generated duplicates on the whole number", async () => {
    const user = await createAuthUser();
    await asUser(user);
    await db.query(
      `insert into contacts (user_id, company_name, phone) values ($1, 'Czech', '+420777123456')`,
      [user],
    );
    const result = await one<{ created: number; duplicates: number }>(
      `select * from import_generated_contacts($1, 5, 'CZ')`,
      [
        JSON.stringify([
          { id: "e1", name: "Same", phone: "+420777123456", address: "A 1" },
          { id: "e2", name: "Slovak", phone: "+421777123456", address: "B 2" },
        ]),
      ],
    );
    expect(result).toEqual({ created: 1, duplicates: 1 });
    await asServer();
  });

  it("keeps the conversion to the server", async () => {
    await asUser(owner);
    await expect(db.query(`select phone_to_e164('777123456', 'CZ')`)).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });
});
