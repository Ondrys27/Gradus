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
grant all on storage.objects, storage.buckets to authenticated;
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
    const lead = (await one<{ id: string }>(`select id from pipeline_stages where system_key = 'lead'`))
      .id;
    await expect(
      db.query(
        `insert into deals (user_id, contact_id, stage_id, title) values ($1, $2, $3, 'x')`,
        [attacker, victimContact, lead],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query(`insert into calendar_events (user_id, title, starts_at, contact_id) values ($1, 'x', now(), $2)`, [
        attacker,
        victimContact,
      ]),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query(
        `insert into attachments (user_id, entity_type, entity_id, storage_path, file_name, mime_type, size_bytes)
         values ($1, 'contact', gen_random_uuid(), $2, 'a.pdf', 'application/pdf', 1)`,
        [attacker, `${victim}/secret.pdf`],
      ),
    ).rejects.toThrow(/attachments_storage_path_owner/);
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
      (await rows<{ system_key: string; id: string }>(`select system_key, id from contact_tables`)).map(
        (r) => [r.system_key, r.id],
      ),
    );
    await expect(
      db.query(`insert into contact_table_entries (user_id, contact_id, table_id) values ($1, $2, $3)`, [
        attacker,
        contact,
        tables.clients,
      ]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.query(
        `insert into contact_table_moves (user_id, contact_id, from_table_id, to_table_id) values ($1, $2, $3, $4)`,
        [attacker, contact, tables.unreached, tables.meeting_scheduled],
      ),
    ).rejects.toThrow(/row-level security/);

    await db.query(`select move_contact($1, $2)`, [contact, tables.unreached]);
    expect((await db.query(`delete from contact_table_entries`)).affectedRows).toBe(0);

    await expect(db.query(`delete from contact_tables where id = $1`, [tables.clients])).rejects.toThrow(
      /system_table_readonly/,
    );
    await expect(
      db.query(`update contact_tables set system_key = 'unreached' where id = $1`, [tables.no_answer]),
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
    expect((await one(`select status from worker_tasks where id = $1`, [task])).status).toBe("done");
    await asServer();
  });

  it("as an owner, cannot bind someone else's account or accept its own invite", async () => {
    await asUser(attacker);
    await expect(
      db.query(`insert into workers (owner_id, user_id, name) values ($1, $2, 'x')`, [attacker, victim]),
    ).rejects.toThrow(/worker_account_link_is_server_only/);
    const worker = (
      await one<{ id: string }>(`insert into workers (owner_id, name) values ($1, 'x') returning id`, [
        attacker,
      ])
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
    await db.query(`update feature_requests set title = 'Dark mode please' where id = $1`, [request]);
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
      await one<{ id: string }>(`insert into milestones (user_id, title) values ($1, 'M2') returning id`, [
        user,
      ])
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

    const lead = (await one<{ id: string }>(`select id from pipeline_stages where system_key = 'lead'`))
      .id;
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
      await one<{ id: string }>(`insert into milestones (user_id, title) values ($1, 'M3') returning id`, [
        user,
      ])
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
