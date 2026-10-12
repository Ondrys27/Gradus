// @vitest-environment node
//
// Jarvis's monthly budget in the database (step 12.1): jarvis_month_spend()
// sums every account's AI spend since an instant and only the server may call
// it; jarvis_budget_alerts keeps one row per day and kind and is closed to
// the client. Runs every migration in PGlite with the same Supabase stubs as
// schema.test.ts.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
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

async function rows<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
  return (await db.query<T>(sql, params as never)).rows;
}
async function one<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
  return (await rows<T>(sql, params))[0] as T;
}
async function asUser(uid: string) {
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`,
  );
}
async function asServer() {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
async function createUser() {
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{}') returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
});

async function asServiceRole() {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
}

describe("jarvis_month_spend", () => {
  it("sums the cost and counts the calls of every account since the instant", async () => {
    const user = await createUser();
    const other = await createUser();
    await asServer();
    await db.query(
      `insert into ai_usage (user_id, purpose, model, cost_usd, success, created_at) values
         ($1, 'chat', 'claude-sonnet-5-5', 1.25, true, '2026-10-02T10:00:00Z'),
         ($2, 'classify', 'claude-haiku-5-5', 0.5, false, '2026-10-12T10:00:00Z'),
         ($1, 'chat', 'claude-sonnet-5-5', 9, true, '2026-09-30T23:59:59Z')`,
      [user, other],
    );
    await asServiceRole();
    const row = await one<{ cost_usd: string; calls: string }>(
      `select cost_usd::text, calls::text from jarvis_month_spend('2026-10-01T00:00:00Z')`,
    );
    expect(Number(row.cost_usd)).toBeCloseTo(1.75, 6);
    expect(Number(row.calls)).toBe(2);
    await asServer();
  });

  it("is not callable by a signed-in user", async () => {
    const user = await createUser();
    await asUser(user);
    await expect(db.query(`select * from jarvis_month_spend(now())`)).rejects.toThrow(
      /permission denied/,
    );
    await asServer();
  });
});

describe("jarvis_budget_alerts", () => {
  it("keeps one row per day and kind", async () => {
    await asServiceRole();
    const first = await db.query(
      `insert into jarvis_budget_alerts (day, kind) values ('2026-10-12', 'near_limit')
       on conflict do nothing returning day`,
    );
    const again = await db.query(
      `insert into jarvis_budget_alerts (day, kind) values ('2026-10-12', 'near_limit')
       on conflict do nothing returning day`,
    );
    expect(first.rows).toHaveLength(1);
    expect(again.rows).toHaveLength(0);
    await expect(
      db.query(`insert into jarvis_budget_alerts (day, kind) values ('2026-10-12', 'other')`),
    ).rejects.toThrow();
    await asServer();
  });

  it("is closed to the client", async () => {
    const user = await createUser();
    await asUser(user);
    await expect(db.query(`select * from jarvis_budget_alerts`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query(`insert into jarvis_budget_alerts (day, kind) values ('2026-10-13', 'paused')`),
    ).rejects.toThrow(/permission denied/);
    await asServer();
  });
});
