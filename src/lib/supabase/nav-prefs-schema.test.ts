// @vitest-environment node
//
// The person's own menu of 30.9: user_settings.nav_prefs is theirs to write,
// its shape is checked by valid_nav_prefs() (the same rules as parseNavPrefs
// in src/components/layout/nav-prefs.ts) and nobody else reads it. Runs every
// migration in PGlite with the Supabase stubs of showcase-mode-schema.test.ts.

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
create function auth.jwt() returns jsonb language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
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
async function asServer() {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`,
  );
}
/** Signs in as `uid`; aal2 with a TOTP step a moment ago unless told otherwise. */
async function asUser(uid: string, aal: "aal1" | "aal2" = "aal2") {
  const now = Math.floor(Date.now() / 1000);
  const amr = [{ method: "password", timestamp: now - 60 }];
  if (aal === "aal2") amr.unshift({ method: "totp", timestamp: now - 30 });
  const claims = JSON.stringify({ sub: uid, aal, session_id: crypto.randomUUID(), amr });
  await asServer();
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role authenticated;`);
}
async function createAuthUser() {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"locale":"cs"}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

let user: string;
let other: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  await createAuthUser(); // first account = owner of the app
  user = await createAuthUser();
  other = await createAuthUser();
}, 120_000);

afterAll(async () => {
  await db?.close();
});


describe("user_settings.nav_prefs", () => {
  it("starts empty and takes the person's own pins, hidden sections and order", async () => {
    await asUser(user);
    const before = await one<{ nav_prefs: unknown }>(
      `select nav_prefs from user_settings where user_id = $1`,
      [user],
    );
    expect(before.nav_prefs).toEqual({});
    await db.query(
      `update user_settings set nav_prefs = '{"pinned":["pipeline"],"hidden":["finance"],"order":["dashboard","calendar","tasks"]}' where user_id = $1`,
      [user],
    );
    const after = await one<{ nav_prefs: { pinned: string[] } }>(
      `select nav_prefs from user_settings where user_id = $1`,
      [user],
    );
    expect(after.nav_prefs.pinned).toEqual(["pipeline"]);
    await asServer();
  });

  it("refuses any other shape", async () => {
    await asUser(user);
    for (const bad of [
      `'[]'`,
      `'{"pinned":"pipeline"}'`,
      `'{"extra":[]}'`,
      `'{"hidden":[1]}'`,
      `'{"order":["${"x".repeat(31)}"]}'`,
    ]) {
      await expect(
        db.query(`update user_settings set nav_prefs = ${bad}::jsonb where user_id = $1`, [user]),
      ).rejects.toThrow(/nav_prefs_valid|check constraint/);
    }
    await asServer();
  });

  it("is nobody else's to read or change", async () => {
    await asUser(other);
    const rows = await db.query(`select nav_prefs from user_settings where user_id = $1`, [user]);
    expect(rows.rows).toHaveLength(0);
    const changed = await db.query(
      `update user_settings set nav_prefs = '{"pinned":["notes"]}' where user_id = $1`,
      [user],
    );
    expect(changed.affectedRows ?? 0).toBe(0);
    await asServer();
  });
});
