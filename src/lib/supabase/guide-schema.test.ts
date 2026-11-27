// @vitest-environment node
//
// The guides of 30.8: Grady's cached answers and the questions people ask
// are the server's alone (no client reads or writes them, and they hold no
// account); the administration's list of top questions leaves internal
// accounts out; the person's own guide settings are theirs to write and their
// shape is checked. Runs every migration in PGlite with the Supabase stubs of
// showcase-mode-schema.test.ts.

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

const KEY = "a".repeat(64);

describe("guide_answers and guide_questions", () => {
  it("are never read or written by a signed-in client", async () => {
    await asServer();
    await db.query(
      `insert into guide_answers (cache_key, section, role, locale, map_version, answer)
       values ($1, 'pipeline', 'owner', 'cs', 'v1abc', '{"kind":"words","answer":"Ano."}')`,
      [KEY],
    );
    await db.query(
      `insert into guide_questions (section, role, locale, question, question_norm, outcome)
       values ('pipeline', 'owner', 'cs', 'Jak přidám obchod?', 'jak pridam obchod', 'steps')`,
    );
    await asUser(user);
    await expect(db.query(`select 1 from guide_answers limit 1`)).rejects.toThrow(/permission denied/);
    await expect(db.query(`select 1 from guide_questions limit 1`)).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        `insert into guide_questions (section, role, locale, question, question_norm, outcome)
         values ('pipeline', 'owner', 'cs', 'x', 'x', 'steps')`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query(`select * from admin_guide_top_questions(now() - interval '1 day', now() + interval '1 day')`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query(`select public.purge_guide()`)).rejects.toThrow(/permission denied/);
    await asServer();
  });

  it("have no column for an account", async () => {
    await asServer();
    const columns = await rows<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_name in ('guide_answers', 'guide_questions') and column_name ~ 'user|account|email'`,
    );
    expect(columns).toEqual([]);
  });

  it("refuse an answer key that is not a hash and an unknown outcome", async () => {
    await asServer();
    await expect(
      db.query(
        `insert into guide_answers (cache_key, section, role, locale, map_version, answer)
         values ('jak pridam obchod', 'pipeline', 'owner', 'cs', 'v1', '{}')`,
      ),
    ).rejects.toThrow(/check/);
    await expect(
      db.query(
        `insert into guide_questions (section, role, locale, question, question_norm, outcome)
         values ('pipeline', 'owner', 'cs', 'x', 'x', 'great')`,
      ),
    ).rejects.toThrow(/check/);
  });

  it("lists the most asked questions without internal accounts", async () => {
    await asServer();
    await db.exec(`delete from guide_questions`);
    await db.exec(`
      insert into guide_questions (section, role, locale, question, question_norm, outcome, internal) values
        ('pipeline', 'owner', 'cs', 'Jak přidám obchod?', 'jak pridam obchod', 'steps', false),
        ('pipeline', 'worker', 'cs', 'jak pridam obchod', 'jak pridam obchod', 'words', false),
        ('finance', 'owner', 'cs', 'Kde je faktura?', 'kde je faktura', 'missing', false),
        ('finance', 'owner', 'cs', 'Interní test', 'interni test', 'steps', true),
        ('finance', 'owner', 'cs', 'Interní test', 'interni test', 'steps', true),
        ('finance', 'owner', 'cs', 'Interní test', 'interni test', 'steps', true);
    `);
    const top = await rows<{ section: string; question: string; asked: number; unanswered: number }>(
      `select section, question, asked::int, unanswered::int
       from admin_guide_top_questions(now() - interval '1 day', now() + interval '1 day', 10)`,
    );
    expect(top).toEqual([
      // Both wordings were asked at the same moment; either is the latest.
      { section: "pipeline", question: expect.stringMatching(/^jak p/i), asked: 2, unanswered: 1 },
      { section: "finance", question: "Kde je faktura?", asked: 1, unanswered: 1 },
    ]);
  });

  it("forgets old questions and unused answers", async () => {
    await asServer();
    await db.exec(`
      insert into guide_questions (section, role, locale, question, question_norm, outcome, created_at)
        values ('notes', 'owner', 'en', 'old', 'old', 'steps', now() - interval '14 months');
      update guide_answers set last_hit_at = now() - interval '61 days';
    `);
    const removed = await one<{ purge_guide: number }>(`select public.purge_guide()`);
    expect(removed.purge_guide).toBe(2);
    expect(await rows(`select 1 from guide_questions where question = 'old'`)).toEqual([]);
  });
});

describe("user_settings.guide_offers and guide_seen", () => {
  it("are the person's own to write", async () => {
    await asUser(user);
    await db.query(
      `update user_settings set guide_offers = false, guide_seen = '{pipeline,notes}' where user_id = $1`,
      [user],
    );
    const own = await one<{ guide_offers: boolean; guide_seen: string[] }>(
      `select guide_offers, guide_seen from user_settings where user_id = $1`,
      [user],
    );
    expect(own).toEqual({ guide_offers: false, guide_seen: ["pipeline", "notes"] });
    // Another account's row is not reachable.
    const changed = await rows(
      `update user_settings set guide_offers = false where user_id = $1 returning 1`,
      [other],
    );
    expect(changed).toEqual([]);
    await asServer();
  });

  it("take only section keys", async () => {
    await asUser(user);
    await expect(
      db.query(`update user_settings set guide_seen = '{"pipe line"}' where user_id = $1`, [user]),
    ).rejects.toThrow(/user_settings_guide_seen_valid/);
    await asServer();
  });
});
