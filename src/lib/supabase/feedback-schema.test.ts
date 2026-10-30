// @vitest-environment node
//
// NPS and Jarvis answer ratings in the database (step 11.5): nps_responses
// takes one answer per insert, owned by its user, never changed afterwards;
// jarvis_messages.rating stays closed to the client, like the rest of the
// table; admin_audit accepts the new 'update' kind. Runs every migration in
// PGlite with the same Supabase stubs as schema.test.ts.

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

describe("nps_responses", () => {
  it("lets a user insert and read only their own answer, never change it", async () => {
    const user = await createUser();
    const other = await createUser();
    await asUser(user);
    const { id } = await one<{ id: string }>(
      `insert into nps_responses (user_id, score, comment) values ($1, 9, 'Great!') returning id`,
      [user],
    );
    expect(await rows(`select id from nps_responses where id = $1`, [id])).toHaveLength(1);
    // No update or delete policy: RLS lets the statement run but it touches no row.
    expect((await db.query(`update nps_responses set score = 0 where id = $1`, [id])).affectedRows).toBe(0);
    expect((await db.query(`delete from nps_responses where id = $1`, [id])).affectedRows).toBe(0);
    await expect(
      db.query(`insert into nps_responses (user_id, score) values ($1, 5)`, [other]),
    ).rejects.toThrow();
    await asUser(other);
    expect(await rows(`select id from nps_responses where id = $1`, [id])).toHaveLength(0);
    await asServer();
    expect(await one(`select score from nps_responses where id = $1`, [id])).toEqual({ score: 9 });
  });

  it("refuses a score outside 0-10", async () => {
    const user = await createUser();
    await asUser(user);
    await expect(
      db.query(`insert into nps_responses (user_id, score) values ($1, 11)`, [user]),
    ).rejects.toThrow();
    await expect(
      db.query(`insert into nps_responses (user_id, score) values ($1, -1)`, [user]),
    ).rejects.toThrow();
    await asServer();
  });
});

describe("satisfaction_responses", () => {
  it("is written and read only by its own user, never changed afterwards", async () => {
    const user = await createUser();
    const other = await createUser();
    await asUser(user);
    await db.query(
      `insert into satisfaction_responses (user_id, satisfaction, liked, improve) values ($1, 4, 'Mapa', null)`,
      [user],
    );
    await expect(
      db.query(`insert into satisfaction_responses (user_id, satisfaction) values ($1, 5)`, [other]),
    ).rejects.toThrow();
    expect(await one(`select count(*)::int as n from satisfaction_responses`)).toEqual({ n: 1 });
    await db.query(`update satisfaction_responses set satisfaction = 1`);
    await db.query(`delete from satisfaction_responses`);
    expect(await one(`select satisfaction from satisfaction_responses`)).toEqual({ satisfaction: 4 });
    await asUser(other);
    expect(await one(`select count(*)::int as n from satisfaction_responses`)).toEqual({ n: 0 });
    await asServer();
  });

  it("takes 1 to 5 and texts of at most 1000 characters", async () => {
    const user = await createUser();
    await asUser(user);
    for (const satisfaction of [0, 6]) {
      await expect(
        db.query(`insert into satisfaction_responses (user_id, satisfaction) values ($1, $2)`, [user, satisfaction]),
      ).rejects.toThrow();
    }
    await expect(
      db.query(`insert into satisfaction_responses (user_id, satisfaction, liked) values ($1, 3, $2)`, [
        user,
        "x".repeat(1001),
      ]),
    ).rejects.toThrow();
    await expect(
      db.query(`insert into satisfaction_responses (user_id, satisfaction, improve) values ($1, 3, '')`, [user]),
    ).rejects.toThrow();
    await asServer();
  });
});

describe("profiles survey pause", () => {
  it("the user sets the pause and the count of closes themselves", async () => {
    const user = await createUser();
    await asUser(user);
    await db.query(
      `update profiles set nps_snoozed_until = now() + interval '1 day', nps_dismiss_streak = 2 where id = $1`,
      [user],
    );
    expect(
      await one(
        `select nps_snoozed_until > now() as paused, nps_dismiss_streak as streak from profiles where id = $1`,
        [user],
      ),
    ).toEqual({ paused: true, streak: 2 });
    await expect(
      db.query(`update profiles set nps_dismiss_streak = 4 where id = $1`, [user]),
    ).rejects.toThrow();
    await asServer();
  });
});

describe("jarvis_messages.rating", () => {
  it("stays closed to the client, even for the message's own user", async () => {
    const user = await createUser();
    const { id } = await one<{ id: string }>(
      `insert into jarvis_conversations (user_id) values ($1) returning id`,
      [user],
    );
    const { id: messageId } = await one<{ id: string }>(
      `insert into jarvis_messages (user_id, conversation_id, role, content)
       values ($1, $2, 'assistant', 'Hi') returning id`,
      [user, id],
    );
    await asUser(user);
    // No update policy at all on jarvis_messages: the statement runs but changes nothing.
    expect(
      (await db.query(`update jarvis_messages set rating = 'up' where id = $1`, [messageId]))
        .affectedRows,
    ).toBe(0);
    await asServer();
    await db.query(`update jarvis_messages set rating = 'up' where id = $1`, [messageId]);
    expect(await one(`select rating from jarvis_messages where id = $1`, [messageId])).toEqual({
      rating: "up",
    });
    await expect(
      db.query(`update jarvis_messages set rating = 'sideways' where id = $1`, [messageId]),
    ).rejects.toThrow();
  });
});

describe("admin_audit_kind", () => {
  it("accepts the new 'update' kind", async () => {
    await asServer();
    const user = await createUser();
    await db.query(`insert into admin_audit (user_id, kind, target) values ($1, 'update', 'x')`, [
      user,
    ]);
    expect(await one(`select kind from admin_audit where user_id = $1`, [user])).toEqual({
      kind: "update",
    });
  });
});
