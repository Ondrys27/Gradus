// @vitest-environment node
//
// The shared workspace: current_workspace_id(), has_section_access() and the
// row level security built on them. An owner and a worker account, the worker
// given different rights, check what the worker may see and write in the
// owner's space and what stays private. Runs every migration in PGlite with
// the same Supabase stubs as schema.test.ts.

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
type Section = "milestones" | "contacts" | "pipeline" | "cold_calling" | "calendar" | "finance";

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
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

/** Replaces the worker's rights: every listed section, nothing else. */
async function grant(access: Partial<Record<Section, "view" | "edit">>) {
  await asServer();
  await db.query(`delete from worker_permissions where worker_id = $1`, [workerId]);
  for (const [section, level] of Object.entries(access)) {
    await db.query(
      `insert into worker_permissions (owner_id, worker_id, section, can_view, can_edit)
       values ($1, $2, $3, true, $4)`,
      [owner, workerId, section, level === "edit"],
    );
  }
}

async function hasAccess(section: string, level: string, of = owner) {
  return (
    await one<{ ok: boolean }>(`select has_section_access($1, $2, $3) as ok`, [of, section, level])
  ).ok;
}

let owner: string;
let worker: string;
let workerId: string;
let stranger: string;
let ownerContact: string;
let tables: Record<string, string>;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser();
  worker = await createAuthUser();
  stranger = await createAuthUser();
  workerId = (
    await one<{ id: string }>(
      `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Caller', 'active') returning id`,
      [owner, worker],
    )
  ).id;
  ownerContact = (
    await one<{ id: string }>(
      `insert into contacts (user_id, company_name) values ($1, 'Owner Ltd') returning id`,
      [owner],
    )
  ).id;
  tables = Object.fromEntries(
    (
      await rows<{ system_key: string; id: string }>(
        `select system_key, id from contact_tables where user_id = $1`,
        [owner],
      )
    ).map((r) => [r.system_key, r.id]),
  );
  await db.query(
    `insert into transactions (user_id, type, amount, occurred_on, description) values ($1, 'income', 1000, current_date, 'Secret')`,
    [owner],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("current_workspace_id", () => {
  it("is the owner's own id, and the owner's id for an active worker", async () => {
    await asUser(owner);
    expect((await one<{ ws: string }>(`select current_workspace_id() as ws`)).ws).toBe(owner);
    await asUser(worker);
    expect((await one<{ ws: string }>(`select current_workspace_id() as ws`)).ws).toBe(owner);
    await asUser(stranger);
    expect((await one<{ ws: string }>(`select current_workspace_id() as ws`)).ws).toBe(stranger);
    await asServer();
  });

  it("falls back to the worker's own account once they are no longer active", async () => {
    await db.query(`update workers set status = 'inactive' where id = $1`, [workerId]);
    await asUser(worker);
    expect((await one<{ ws: string }>(`select current_workspace_id() as ws`)).ws).toBe(worker);
    await asServer();
    await db.query(`update workers set status = 'active' where id = $1`, [workerId]);
  });
});

describe("has_section_access", () => {
  it("is always true for the owner in their own space, even for workers and settings", async () => {
    await asUser(owner);
    for (const section of ["contacts", "finance", "workers", "settings"]) {
      expect(await hasAccess(section, "edit")).toBe(true);
    }
    await asServer();
  });

  it("follows the worker's permissions, edit including view", async () => {
    await grant({ contacts: "edit", cold_calling: "view" });
    await asUser(worker);
    expect(await hasAccess("contacts", "view")).toBe(true);
    expect(await hasAccess("contacts", "edit")).toBe(true);
    expect(await hasAccess("cold_calling", "view")).toBe(true);
    expect(await hasAccess("cold_calling", "edit")).toBe(false);
    expect(await hasAccess("finance", "view")).toBe(false);
    expect(await hasAccess("pipeline", "view")).toBe(false);
    await asServer();
  });

  it("never opens workers or settings to a worker, even with a stray row", async () => {
    await grant({});
    await db.query(
      `insert into worker_permissions (owner_id, worker_id, section, can_view, can_edit)
       values ($1, $2, 'workers', true, true)`,
      [owner, workerId],
    );
    await asUser(worker);
    expect(await hasAccess("workers", "view")).toBe(false);
    expect(await hasAccess("settings", "view")).toBe(false);
    expect(await hasAccess("contacts", "nonsense")).toBe(false);
    await asServer();
  });

  it("is false for another owner's space, an inactive worker and nobody signed in", async () => {
    await grant({ contacts: "edit" });
    await asUser(worker);
    expect(await hasAccess("contacts", "view", stranger)).toBe(false);
    await asUser(stranger);
    expect(await hasAccess("contacts", "view")).toBe(false);
    await asServer();
    await db.query(`update workers set status = 'inactive' where id = $1`, [workerId]);
    await asUser(worker);
    expect(await hasAccess("contacts", "view")).toBe(false);
    await asServer();
    await db.query(`update workers set status = 'active' where id = $1`, [workerId]);
    expect(await hasAccess("contacts", "view")).toBe(false);
  });
});

describe("row level security in the shared space", () => {
  it("shows the owner's contacts to a worker with the right, and hides them without it", async () => {
    await grant({ contacts: "view" });
    await asUser(worker);
    expect(await count(`select 1 from contacts where id = $1`, [ownerContact])).toBe(1);
    expect(await count(`select 1 from contact_list where id = $1`, [ownerContact])).toBe(1);
    expect(await count(`select 1 from contact_tables where user_id = $1`, [owner])).toBe(7);

    await grant({ cold_calling: "view" });
    await asUser(worker);
    // Cold calling works on the same tables.
    expect(await count(`select 1 from contacts where id = $1`, [ownerContact])).toBe(1);

    await grant({ pipeline: "edit" });
    await asUser(worker);
    expect(await count(`select 1 from contacts where id = $1`, [ownerContact])).toBe(0);
    expect(await count(`select 1 from contact_table_entries where user_id = $1`, [owner])).toBe(0);
    await asServer();
  });

  it("lets a worker without edit rights write nothing", async () => {
    await grant({ contacts: "view" });
    await asUser(worker);
    await expect(
      db.query(`insert into contacts (user_id, company_name) values ($1, 'Sneak')`, [owner]),
    ).rejects.toThrow(/row-level security/);
    const updated = await db.query(`update contacts set company_name = 'Renamed' where id = $1`, [
      ownerContact,
    ]);
    expect(updated.affectedRows ?? 0).toBe(0);
    const deleted = await db.query(`delete from contacts where id = $1`, [ownerContact]);
    expect(deleted.affectedRows ?? 0).toBe(0);
    await expect(
      db.query(`select move_contact($1, $2, '{}')`, [ownerContact, tables.no_answer]),
    ).rejects.toThrow(/section_access_denied/);
    await expect(db.query(`select * from start_prospecting()`)).rejects.toThrow(
      /section_access_denied/,
    );
    await asServer();
    expect(
      (
        await one<{ name: string }>(`select company_name as name from contacts where id = $1`, [
          ownerContact,
        ])
      ).name,
    ).toBe("Owner Ltd");
  });

  it("lets a worker with edit rights create rows in the owner's space, stamped as theirs", async () => {
    await grant({ contacts: "edit" });
    await asUser(worker);
    const created = await one<{ id: string }>(
      `insert into contacts (user_id, company_name) values ($1, 'Worker lead') returning id`,
      [owner],
    );
    // New contacts land in the owner's Unreached table.
    expect(
      (
        await one<{ table_id: string }>(
          `select table_id from contact_table_entries where contact_id = $1`,
          [created.id],
        )
      ).table_id,
    ).toBe(tables.unreached);
    // The client cannot name someone else as the actor.
    const activity = await one<{ actor_id: string; user_id: string }>(
      `insert into contact_activities (user_id, actor_id, contact_id, type, content)
       values ($1, $1, $2, 'call', 'Called') returning actor_id, user_id`,
      [owner, created.id],
    );
    expect(activity).toEqual({ actor_id: worker, user_id: owner });
    // Its own space is not the owner's: a row in a stranger's space is refused.
    await expect(
      db.query(`insert into contacts (user_id, company_name) values ($1, 'Elsewhere')`, [stranger]),
    ).rejects.toThrow(/row-level security/);
    await asServer();
  });

  it("records the worker as the actor of a move and a booked meeting", async () => {
    await grant({ cold_calling: "edit" });
    await asUser(worker);
    const meetingAt = (
      await one<{ id: string }>(
        `select id from contact_table_fields where table_id = $1 and system_key = 'meeting_at'`,
        [tables.meeting_scheduled],
      )
    ).id;
    await db.query(`select move_contact($1, $2, $3)`, [
      ownerContact,
      tables.meeting_scheduled,
      JSON.stringify({ [meetingAt]: "2026-11-02T10:00" }),
    ]);
    await asServer();
    const move = await one<{ user_id: string; actor_id: string }>(
      `select user_id, actor_id from contact_table_moves where contact_id = $1 order by created_at desc limit 1`,
      [ownerContact],
    );
    expect(move).toEqual({ user_id: owner, actor_id: worker });
    const event = await one<{ user_id: string; actor_id: string }>(
      `select user_id, actor_id from calendar_events where contact_id = $1`,
      [ownerContact],
    );
    expect(event).toEqual({ user_id: owner, actor_id: worker });
    // Without calendar rights the worker does not see the event it booked.
    await asUser(worker);
    expect(await count(`select 1 from calendar_events where contact_id = $1`, [ownerContact])).toBe(
      0,
    );
    await asServer();
  });

  it("never shows the owner's finance, settings or workers to a worker without them", async () => {
    await grant({ contacts: "edit", cold_calling: "edit", pipeline: "edit", calendar: "edit" });
    await asUser(worker);
    expect(await count(`select 1 from transactions where user_id = $1`, [owner])).toBe(0);
    expect(
      await count(
        `select 1 from finance_totals(current_date - 1, current_date + 1) where income > 0`,
      ),
    ).toBe(0);
    expect(await count(`select 1 from user_settings where user_id = $1`, [owner])).toBe(0);
    expect(await count(`select 1 from profiles where id = $1`, [owner])).toBe(0);
    expect(
      await count(`select 1 from workers where owner_id = $1 and user_id <> $2`, [owner, worker]),
    ).toBe(0);
    expect(await count(`select 1 from worker_invites`)).toBe(0);
    expect(await count(`select 1 from reward_drafts`)).toBe(0);
    expect(await count(`select * from search_matches('invoice', 'secret', '{}', null, 6)`)).toBe(0);
    expect(await count(`select * from search_matches('worker', 'caller', '{}', null, 6)`)).toBe(0);
    await expect(
      db.query(
        `insert into transactions (user_id, type, amount, occurred_on) values ($1, 'expense', 1, current_date)`,
        [owner],
      ),
    ).rejects.toThrow(/row-level security/);

    // Finance only with an explicit right.
    await grant({ finance: "view" });
    await asUser(worker);
    expect(await count(`select 1 from transactions where user_id = $1`, [owner])).toBe(1);
    expect(await count(`select 1 from user_settings where user_id = $1`, [owner])).toBe(0);
    await asServer();
  });

  it("keeps the owner's private tables private", async () => {
    await grant({
      milestones: "edit",
      contacts: "edit",
      pipeline: "edit",
      cold_calling: "edit",
      calendar: "edit",
      finance: "edit",
    });
    await db.query(
      `insert into xp_events (user_id, kind, xp, idempotency_key) values ($1, 'task_completed', 10, 'x')`,
      [owner],
    );
    await db.query(`insert into jarvis_conversations (user_id, title) values ($1, 'Private')`, [
      owner,
    ]);
    await db.query(`insert into feature_requests (user_id, title) values ($1, 'Idea')`, [owner]);
    await asUser(worker);
    expect(await count(`select 1 from xp_events where user_id = $1`, [owner])).toBe(0);
    expect(await count(`select 1 from jarvis_conversations where user_id = $1`, [owner])).toBe(0);
    expect(await count(`select 1 from feature_requests where user_id = $1`, [owner])).toBe(0);
    expect(await count(`select 1 from user_settings where user_id = $1`, [owner])).toBe(0);
    expect(await count(`select 1 from user_roles where user_id = $1`, [owner])).toBe(0);
    await asServer();
  });

  it("stops the access the moment a right is taken away or the worker is deactivated", async () => {
    await grant({ contacts: "view" });
    await asUser(worker);
    expect(await count(`select 1 from contacts where id = $1`, [ownerContact])).toBe(1);
    await grant({});
    await asUser(worker);
    expect(await count(`select 1 from contacts where id = $1`, [ownerContact])).toBe(0);
    await grant({ contacts: "view" });
    await db.query(`update workers set status = 'inactive' where id = $1`, [workerId]);
    await asUser(worker);
    expect(await count(`select 1 from contacts where id = $1`, [ownerContact])).toBe(0);
    await asServer();
    await db.query(`update workers set status = 'active' where id = $1`, [workerId]);
  });
});

describe("milestones in the shared space", () => {
  it("stamps who completed a task", async () => {
    await grant({ milestones: "edit" });
    await asUser(worker);
    const milestone = (
      await one<{ id: string }>(
        `insert into milestones (user_id, title) values ($1, 'Shared') returning id`,
        [owner],
      )
    ).id;
    const task = (
      await one<{ id: string }>(
        `insert into tasks (user_id, milestone_id, title, completed_by) values ($1, $2, 'Do it', $1) returning id`,
        [owner, milestone],
      )
    ).id;
    await db.query(`update tasks set status = 'done', completed_by = $2 where id = $1`, [
      task,
      owner,
    ]);
    expect(
      (await one<{ by: string }>(`select completed_by as by from tasks where id = $1`, [task])).by,
    ).toBe(worker);
    await db.query(`update tasks set status = 'todo' where id = $1`, [task]);
    expect(
      (
        await one<{ by: string | null }>(`select completed_by as by from tasks where id = $1`, [
          task,
        ])
      ).by,
    ).toBeNull();
    await asServer();
  });
});

describe("prospecting timer per person", () => {
  it("runs one timer for the owner and one for the worker in the same space", async () => {
    await grant({ cold_calling: "edit" });
    await asUser(owner);
    const mine = await one<{ id: string; actor_id: string }>(`select * from start_prospecting()`);
    expect(mine.actor_id).toBe(owner);
    await asUser(worker);
    const theirs = await one<{ id: string; user_id: string; actor_id: string }>(
      `select * from start_prospecting()`,
    );
    expect(theirs).toMatchObject({ user_id: owner, actor_id: worker });
    expect(theirs.id).not.toBe(mine.id);
    expect(
      (await one<{ running: boolean }>(`select * from prospecting_status('UTC')`)).running,
    ).toBe(true);

    // A worker sees only their own segments; the owner sees both.
    expect(await count(`select 1 from prospecting_segments`)).toBe(1);
    await asUser(owner);
    expect(await count(`select 1 from prospecting_segments where user_id = $1`, [owner])).toBe(2);

    await asServer();
    await db.query(
      `update prospecting_segments set started_at = now() - interval '10 minutes' where id = any($1)`,
      [[mine.id, theirs.id]],
    );
    await asUser(worker);
    await db.query(`select * from pause_prospecting()`);
    await asUser(owner);
    expect(
      (await one<{ running: boolean }>(`select * from prospecting_status('UTC')`)).running,
    ).toBe(true);
    await db.query(`select * from pause_prospecting()`);

    // Statistics: the owner sees the total or one person, the worker only their own.
    const total = await one<{ s: number }>(
      `select sum(seconds)::int as s from prospecting_daily_seconds(current_date - 1, current_date + 1, 'UTC')`,
    );
    const workerOnly = await one<{ s: number }>(
      `select sum(seconds)::int as s from prospecting_daily_seconds(current_date - 1, current_date + 1, 'UTC', $1)`,
      [worker],
    );
    expect(total.s).toBeGreaterThanOrEqual(19 * 60);
    expect(workerOnly.s).toBeGreaterThanOrEqual(9 * 60);
    expect(workerOnly.s).toBeLessThan(total.s);
    await asUser(worker);
    const asked = await one<{ s: number }>(
      `select sum(seconds)::int as s from prospecting_daily_seconds(current_date - 1, current_date + 1, 'UTC', $1)`,
      [owner],
    );
    expect(asked.s).toBe(workerOnly.s);
    const meetings = await one<{ n: number }>(
      `select coalesce(sum(meetings), 0)::int as n from meetings_daily(current_date - 1, current_date + 1, 'UTC')`,
    );
    // The worker booked one meeting above (move into Meeting scheduled).
    expect(meetings.n).toBe(1);
    await asServer();
  });
});
