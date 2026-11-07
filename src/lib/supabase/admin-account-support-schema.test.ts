// @vitest-environment node
//
// Support for one account in the administration (step 22.1): "Sign out
// everywhere" removes every Auth session of the account with its refresh
// tokens and ends its live admin session, and touches nobody else. Only the
// server (service role) may call it. Runs every migration in PGlite with the
// Supabase stubs, including the two Auth tables the function deletes from.

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
create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade
);
create table auth.refresh_tokens (
  id bigserial primary key,
  token text,
  user_id varchar(255),
  session_id uuid references auth.sessions (id) on delete cascade
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

let db: PGlite;

async function one<T>(sql: string, params?: unknown[]): Promise<T> {
  return (await db.query<T>(sql, params as never)).rows[0] as T;
}

async function asServer() {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`,
  );
}

async function createAuthUser(): Promise<string> {
  await asServer();
  const { id } = await one<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [`${crypto.randomUUID()}@example.com`],
  );
  return id;
}

/** Two signed-in devices and one old refresh token without a session. */
async function signInTwice(userId: string) {
  await asServer();
  for (let i = 0; i < 2; i++) {
    const { id } = await one<{ id: string }>(
      `insert into auth.sessions (user_id) values ($1) returning id`,
      [userId],
    );
    await db.query(`insert into auth.refresh_tokens (token, user_id, session_id) values ($1, $2, $3)`, [
      crypto.randomUUID(),
      userId,
      id,
    ]);
  }
  await db.query(`insert into auth.refresh_tokens (token, user_id) values ($1, $2)`, [
    crypto.randomUUID(),
    userId,
  ]);
  await db.query(
    `insert into public.admin_sessions (session_id, user_id, started_at) values (gen_random_uuid(), $1, now())`,
    [userId],
  );
}

async function counts(userId: string) {
  await asServer();
  return one<{ sessions: number; tokens: number; admin: number }>(
    `select
       (select count(*)::int from auth.sessions where user_id = $1) as sessions,
       (select count(*)::int from auth.refresh_tokens where user_id = $1::text) as tokens,
       (select count(*)::int from public.admin_sessions where user_id = $1 and ended_at is null) as admin`,
    [userId],
  );
}

let owner: string;
let target: string;
let bystander: string;

beforeAll(async () => {
  db = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  owner = await createAuthUser(); // first account = owner
  target = await createAuthUser();
  bystander = await createAuthUser();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("admin_user_sign_out", () => {
  it("is closed to signed-in clients", async () => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [owner]);
    await db.exec(`set role authenticated;`);
    await expect(db.query(`select public.admin_user_sign_out($1)`, [target])).rejects.toThrow(
      /permission denied/,
    );
    await db.exec(`set role anon;`);
    await expect(db.query(`select public.admin_user_sign_out($1)`, [target])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("ends every sign-in of the account and nobody else's", async () => {
    await signInTwice(target);
    await signInTwice(bystander);
    expect(await counts(target)).toEqual({ sessions: 2, tokens: 3, admin: 1 });

    await asServer();
    await db.exec(`set role service_role;`);
    const { n } = await one<{ n: number }>(`select public.admin_user_sign_out($1) as n`, [target]);
    expect(n).toBe(2);

    expect(await counts(target)).toEqual({ sessions: 0, tokens: 0, admin: 0 });
    expect(await counts(bystander)).toEqual({ sessions: 2, tokens: 3, admin: 1 });
  });

  it("is a no-op for an account that is signed out already, and needs an account", async () => {
    await asServer();
    await db.exec(`set role service_role;`);
    expect((await one<{ n: number }>(`select public.admin_user_sign_out($1) as n`, [target])).n).toBe(0);
    await expect(db.query(`select public.admin_user_sign_out(null)`)).rejects.toThrow(/user required/);
  });
});

describe("admin_email_taken", () => {
  it("knows an address in use whatever its case, for the server only", async () => {
    await asServer();
    const { email } = await one<{ email: string }>(`select email from auth.users where id = $1`, [target]);
    await db.exec(`set role service_role;`);
    expect((await one<{ t: boolean }>(`select public.admin_email_taken($1) as t`, [` ${email.toUpperCase()} `])).t).toBe(true);
    expect((await one<{ t: boolean }>(`select public.admin_email_taken('nobody@example.com') as t`)).t).toBe(false);
    await db.exec(`reset role; set role authenticated;`);
    await expect(db.query(`select public.admin_email_taken('x@example.com')`)).rejects.toThrow(/permission denied/);
  });
});
