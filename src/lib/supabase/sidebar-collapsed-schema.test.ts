// @vitest-environment node
//
// Collapsible sidebar (19.1) on the real migrations (PGlite):
// user_settings.sidebar_collapsed starts off, each account (owner or worker)
// changes only its own, and it stays a setting a read-only space may change.

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

let db: PGlite;
let owner: string;
let worker: string;
let stranger: string;

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
async function createAuthUser() {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return rows[0]!.id;
}
async function collapsed(uid: string) {
  const { rows } = await db.query<{ sidebar_collapsed: boolean }>(
    `select sidebar_collapsed from user_settings where user_id = $1`,
    [uid],
  );
  return rows[0]?.sidebar_collapsed;
}
function setCollapsed(uid: string, target: string, value: boolean) {
  return as(uid, () =>
    db.query(`update user_settings set sidebar_collapsed = $2 where user_id = $1`, [target, value]),
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
  worker = await createAuthUser();
  stranger = await createAuthUser();
  await db.query(
    `insert into workers (owner_id, user_id, name, status) values ($1, $2, 'Worker', 'active')`,
    [owner, worker],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("user_settings.sidebar_collapsed", () => {
  it("starts expanded for every new account", async () => {
    expect(await collapsed(owner)).toBe(false);
    expect(await collapsed(worker)).toBe(false);
  });

  it("is changed by the owner and the worker each on their own row", async () => {
    const own = await setCollapsed(owner, owner, true);
    expect(own.affectedRows).toBe(1);
    expect(await collapsed(owner)).toBe(true);

    const workers = await setCollapsed(worker, worker, true);
    expect(workers.affectedRows).toBe(1);
    expect(await collapsed(worker)).toBe(true);
  });

  it("never reaches anyone else's settings, not even the owner's from the worker", async () => {
    await setCollapsed(owner, owner, false);
    expect((await setCollapsed(stranger, owner, true)).affectedRows).toBe(0);
    expect((await setCollapsed(worker, owner, true)).affectedRows).toBe(0);
    expect(await collapsed(owner)).toBe(false);
    const seen = await as(stranger, () =>
      db.query(`select sidebar_collapsed from user_settings where user_id = $1`, [owner]),
    );
    expect(seen.rows).toEqual([]);
  });

  it("is not held back by the read-only mode of a space", async () => {
    const { rows } = await db.query<{ tgname: string }>(
      `select tgname from pg_trigger
       where tgrelid = 'public.user_settings'::regclass and not tgisinternal`,
    );
    expect(rows.map((row) => row.tgname).join(" ")).not.toMatch(/writable/);
  });
});
