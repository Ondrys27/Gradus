// @vitest-environment node
//
// Runs the real migration in an in-process Postgres (PGlite) with the same
// auth/storage stubs Supabase provides, then checks the business rules that
// live in the database: account initialisation, RLS, contact moves, won deals,
// task locking and the idle rule of the prospecting timer.

import { PGlite } from "@electric-sql/pglite";
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
grant usage on schema public, auth, storage to anon, authenticated, service_role, supabase_auth_admin;
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
  db = new PGlite();
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
    await expect(
      db.query(`insert into usage_events (user_id, event_type) values ('${owner}', 'x')`),
    ).rejects.toThrow(/row-level security/);
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
    const entry = await one<{ table_id: string }>(`select * from move_contact($1, $2, $3)`, [
      contact,
      tables.failed,
      JSON.stringify({ reason: "other" }),
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
      `insert into contact_table_moves (user_id, contact_id, from_table_id, to_table_id, created_at)
       values ('${owner}', '${contact}', '${unreached}', '${meeting}', now() - interval '20 minutes')`,
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
    expect(
      (
        await one<{ id: string }>(
          `insert into work_sessions (owner_id, worker_id) values ('${owner}', '${worker}') returning id`,
        )
      ).id,
    ).toBeTruthy();
    await asServer();
  });
});
