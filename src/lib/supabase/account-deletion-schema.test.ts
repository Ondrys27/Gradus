// @vitest-environment node
//
// Deleting an account (step 12.5): what blocks it, which files are the
// account's, and that deleting the auth user removes every row of the account
// and nothing of anyone else — rows a worker made in the owner's workspace
// stay with the owner, the usage analytics stay without the person. Runs every
// migration in PGlite with the same Supabase stubs as schema.test.ts; the
// server deletes through Supabase Auth, here `delete from auth.users`.

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
async function createAuthUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

/** Every column in public that points at an account, with the table it is in. */
async function accountColumns() {
  return rows<{ tbl: string; col: string }>(
    `select c.conrelid::regclass::text as tbl, a.attname as col
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
       and c.connamespace = 'public'::regnamespace
     order by 1, 2`,
  );
}

/** How many rows every account column holds for each of the accounts. */
async function footprint(accounts: string[]) {
  const out: Record<string, number> = {};
  for (const { tbl, col } of await accountColumns()) {
    for (const account of accounts) {
      out[`${tbl}.${col}:${account}`] = await count(`select 1 from ${tbl} where ${col} = $1`, [
        account,
      ]);
    }
  }
  return out;
}

let invoiceNumber = 0;

/** A small but complete workspace: the things the export and deletion care about. */
async function fillWorkspace(space: string, actor: string) {
  await asServer();
  const milestone = (
    await one<{ id: string }>(
      `insert into milestones (user_id, title) values ($1, 'Launch') returning id`,
      [space],
    )
  ).id;
  await db.query(`insert into tasks (user_id, milestone_id, title) values ($1, $2, 'Call bank')`, [
    space,
    milestone,
  ]);
  const contact = (
    await one<{ id: string }>(
      `insert into contacts (user_id, first_name, last_name, email) values ($1, 'Jan', 'Novák', 'jan@example.com') returning id`,
      [space],
    )
  ).id;
  const stage = (
    await one<{ id: string }>(
      `select id from pipeline_stages where user_id = $1 order by position limit 1`,
      [space],
    )
  ).id;
  const deal = (
    await one<{ id: string }>(
      `insert into deals (user_id, stage_id, title, contact_id, value, created_by, deadline_date)
       values ($1, $2, 'Web', $3, 10000, $4, current_date + 7) returning id`,
      [space, stage, contact, actor],
    )
  ).id;
  await db.query(
    `insert into crm_tasks (user_id, title, due_at, deal_id, created_by, assignee_id)
     values ($1, 'Follow up', now() + interval '1 day', $2, $3, $3)`,
    [space, deal, actor],
  );
  await db.query(
    `insert into contact_activities (user_id, contact_id, type, actor_id, content) values ($1, $2, 'note', $3, 'Met')`,
    [space, contact, actor],
  );
  await db.query(
    `insert into calendar_events (user_id, title, starts_at, actor_id) values ($1, 'Meeting', now(), $2)`,
    [space, actor],
  );
  await db.query(
    `insert into transactions (user_id, amount, type, occurred_on) values ($1, 500, 'income', current_date)`,
    [space],
  );
  await db.query(`insert into notes (user_id, title, content_text) values ($1, 'Pricing', 'x')`, [
    space,
  ]);
  // An issued invoice: the browser can never delete it, the account deletion must.
  await db.query(
    `insert into invoices (user_id, amount, status, number, kind) values ($1, 1000, 'open', $2, 'invoice')`,
    [space, `2026-${String(++invoiceNumber).padStart(4, "0")}`],
  );
  await db.query(
    `insert into analytics_events (user_id, owner_id, event) values ($1, $2, 'signed_in')`,
    [actor, space],
  );
}

let appOwner: string;
let boss: string;
let worker: string;
let workerRecord: string;
let solo: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  appOwner = await createAuthUser();
  boss = await createAuthUser();
  worker = await createAuthUser();
  solo = await createAuthUser();
  await asServer();
  workerRecord = (
    await one<{ id: string }>(
      `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Pepa', 'active') returning id`,
      [boss, worker],
    )
  ).id;
  await fillWorkspace(boss, boss);
  await fillWorkspace(solo, solo);
  await fillWorkspace(worker, worker);
  // The worker's own work in the boss's workspace.
  await fillWorkspace(boss, worker);
  await asServer();
  for (const [bucket, name] of [
    ["avatars", `${solo}/avatar.webp`],
    ["attachments", `${solo}/jarvis/a1`],
    ["attachments", `${solo}/email/e1`],
    ["invoices", `${solo}/inv-1.pdf`],
    ["bug-screenshots", `${solo}/report-1.jpg`],
    ["avatars", `${boss}/avatar.webp`],
    ["invoices", `${boss}/inv-9.pdf`],
    // Not solo's folder, only a name that starts the same way.
    ["attachments", `${solo}x/other`],
  ]) {
    await db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]);
  }
});

afterAll(async () => {
  await db?.close();
});

describe("account deletion functions", () => {
  it("are for the server only", async () => {
    for (const fn of [
      "account_deletion_blockers",
      "account_storage_objects",
      "account_prepare_deletion",
    ]) {
      await asUser(solo);
      await expect(db.query(`select public.${fn}($1)`, [solo])).rejects.toThrow(
        /permission denied/,
      );
      await asServer();
      await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role anon;`);
      await expect(db.query(`select public.${fn}($1)`, [solo])).rejects.toThrow(
        /permission denied/,
      );
    }
    await asServer();
  });

  it("block the app owner and an owner with active workers", async () => {
    await asServiceRole();
    const blockers = async (user: string) =>
      (await one<{ b: string[] }>(`select public.account_deletion_blockers($1) as b`, [user])).b;
    expect(await blockers(appOwner)).toEqual(["app_owner"]);
    expect(await blockers(boss)).toEqual(["active_workers"]);
    expect(await blockers(solo)).toEqual([]);
    expect(await blockers(worker)).toEqual([]);
    await expect(db.query(`select public.account_prepare_deletion($1)`, [boss])).rejects.toThrow(
      /active_workers/,
    );
    await expect(
      db.query(`select public.account_prepare_deletion($1)`, [appOwner]),
    ).rejects.toThrow(/app_owner/);
    await asServer();
  });

  it("list only the account's own files", async () => {
    await asServiceRole();
    const files = await rows<{ bucket_id: string; name: string }>(
      `select * from public.account_storage_objects($1)`,
      [solo],
    );
    expect(files.map((f) => `${f.bucket_id}:${f.name}`).sort()).toEqual(
      [
        `attachments:${solo}/email/e1`,
        `attachments:${solo}/jarvis/a1`,
        `avatars:${solo}/avatar.webp`,
        `bug-screenshots:${solo}/report-1.jpg`,
        `invoices:${solo}/inv-1.pdf`,
      ].sort(),
    );
    await asServer();
  });
});

describe("deleting an account", () => {
  it("removes every row of the account and nothing of anyone else", async () => {
    await asServer();
    const others = [appOwner, boss, worker];
    const before = await footprint(others);
    const eventsBefore = await count(`select 1 from analytics_events`);
    expect(await count(`select 1 from deals where user_id = $1`, [solo])).toBeGreaterThan(0);

    await asServiceRole();
    await db.query(`select public.account_prepare_deletion($1)`, [solo]);
    await asServer();
    await db.query(`delete from auth.users where id = $1`, [solo]);

    const after = await footprint([...others, solo]);
    for (const [key, n] of Object.entries(after)) {
      if (key.endsWith(`:${solo}`)) expect(n, key).toBe(0);
      else expect(n, key).toBe(before[key]);
    }
    // The usage analytics stay, without the person.
    expect(await count(`select 1 from analytics_events`)).toBe(eventsBefore);
  });

  it("keeps what a worker made in the owner's workspace and retires the worker record", async () => {
    await asServer();
    const bossDeals = await count(`select 1 from deals where user_id = $1`, [boss]);
    const bossActivities = await count(`select 1 from contact_activities where user_id = $1`, [
      boss,
    ]);
    expect(
      await count(`select 1 from deals where user_id = $1 and created_by = $2`, [boss, worker]),
    ).toBe(1);

    await asServiceRole();
    await db.query(`select public.account_prepare_deletion($1)`, [worker]);
    await asServer();
    await db.query(`delete from auth.users where id = $1`, [worker]);

    expect(await count(`select 1 from deals where user_id = $1`, [boss])).toBe(bossDeals);
    expect(await count(`select 1 from contact_activities where user_id = $1`, [boss])).toBe(
      bossActivities,
    );
    expect(
      await count(`select 1 from deals where user_id = $1 and created_by is null`, [boss]),
    ).toBe(1);
    expect(await one(`select user_id, status from workers where id = $1`, [workerRecord])).toEqual({
      user_id: null,
      status: "inactive",
    });
    expect(
      await count(`select 1 from analytics_events where user_id is null and owner_id = $1`, [boss]),
    ).toBe(1);

    // With no active worker left, the owner may go too.
    await asServiceRole();
    expect(
      (await one<{ b: string[] }>(`select public.account_deletion_blockers($1) as b`, [boss])).b,
    ).toEqual([]);
    await asServer();
  });
});
