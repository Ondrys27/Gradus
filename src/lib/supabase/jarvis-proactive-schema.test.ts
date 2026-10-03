// @vitest-environment node
//
// The proactive Jarvis in the database (step 9.7): the new columns of
// jarvis_suggestions stay server-only, the settings accept only sane values,
// the tour stamp is the user's own, and jarvis_briefing_candidates() picks
// exactly the users whose morning brief is due. Runs every migration in
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
async function suggestion(uid: string, kind: "suggestion" | "question" = "suggestion") {
  const type = kind === "question" ? "question" : "insight";
  return (
    await one<{ id: string }>(
      `insert into jarvis_suggestions (user_id, kind, type, text) values ($1, $2, $3, 'Note') returning id`,
      [uid, kind, type],
    )
  ).id;
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

describe("jarvis_suggestions proactive columns", () => {
  it("defaults to a suggestion and pairs briefing and question kinds with their type", async () => {
    const user = await createUser();
    const id = await suggestion(user);
    expect(
      await one(`select kind, payload, shown_at from jarvis_suggestions where id = $1`, [id]),
    ).toEqual({ kind: "suggestion", payload: {}, shown_at: null });
    await expect(
      db.query(
        `insert into jarvis_suggestions (user_id, kind, type, text) values ($1, 'briefing', 'insight', 'x')`,
        [user],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into jarvis_suggestions (user_id, kind, type, text) values ($1, 'suggestion', 'question', 'x')`,
        [user],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into jarvis_suggestions (user_id, kind, type, text, payload) values ($1, 'briefing', 'briefing', 'x', '[]')`,
        [user],
      ),
    ).rejects.toThrow();
  });

  it("lets the client stamp seen and dismissed only, never the new server columns", async () => {
    const user = await createUser();
    const id = await suggestion(user, "question");
    await asUser(user);
    await db.query(
      `update jarvis_suggestions set seen_at = now(), dismissed_at = now() where id = $1`,
      [id],
    );
    for (const set of [
      `shown_at = now()`,
      `answered_at = now()`,
      `snoozed_until = now()`,
      `payload = '{"answer": "hacked"}'`,
      `kind = 'suggestion', type = 'insight'`,
    ]) {
      await expect(
        db.query(`update jarvis_suggestions set ${set} where id = $1`, [id]),
      ).rejects.toThrow(/server_only/);
    }
    await expect(
      db.query(
        `insert into jarvis_suggestions (user_id, kind, type, text) values ($1, 'briefing', 'briefing', 'x')`,
        [user],
      ),
    ).rejects.toThrow();
    await asServer();
    const row = await one<{ seen: boolean; answered_at: string | null }>(
      `select seen_at is not null as seen, answered_at from jarvis_suggestions where id = $1`,
      [id],
    );
    expect(row).toEqual({ seen: true, answered_at: null });
  });

  it("hides another user's suggestions", async () => {
    const owner = await createUser();
    const other = await createUser();
    const id = await suggestion(owner);
    await asUser(other);
    expect(await rows(`select id from jarvis_suggestions where id = $1`, [id])).toHaveLength(0);
    await db.query(`update jarvis_suggestions set dismissed_at = now() where id = $1`, [id]);
    await asServer();
    expect(await one(`select dismissed_at from jarvis_suggestions where id = $1`, [id])).toEqual({
      dismissed_at: null,
    });
  });
});

describe("settings and tour", () => {
  it("accepts a frequency and quiet hours only as whole, different hours", async () => {
    const user = await createUser();
    await asUser(user);
    expect(
      await one(
        `select jarvis_proactive, jarvis_frequency, jarvis_quiet_from from user_settings where user_id = $1`,
        [user],
      ),
    ).toEqual({ jarvis_proactive: true, jarvis_frequency: "sometimes", jarvis_quiet_from: null });
    await db.query(
      `update user_settings set jarvis_frequency = 'often', jarvis_quiet_from = 22, jarvis_quiet_to = 7 where user_id = $1`,
      [user],
    );
    for (const set of [
      `jarvis_frequency = 'always'`,
      `jarvis_quiet_from = 24`,
      `jarvis_quiet_from = 8, jarvis_quiet_to = 8`,
      `jarvis_quiet_from = 8, jarvis_quiet_to = null`,
    ]) {
      await expect(
        db.query(`update user_settings set ${set} where user_id = $1`, [user]),
      ).rejects.toThrow();
    }
    await db.query(`update profiles set tour_completed_at = now() where id = $1`, [user]);
    await asServer();
    expect(
      await one(`select tour_completed_at is not null as done from profiles where id = $1`, [user]),
    ).toEqual({ done: true });
  });
});

describe("jarvis_briefing_candidates", () => {
  async function readyUser(timezone: string, mode: "game" | "tool" = "tool") {
    const user = await createUser();
    await db.query(`update profiles set onboarding_completed_at = now(), mode = $2 where id = $1`, [
      user,
      mode,
    ]);
    await db.query(`update user_settings set timezone = $2 where user_id = $1`, [user, timezone]);
    await db.query(`insert into milestones (user_id, title) values ($1, 'Active')`, [user]);
    return user;
  }
  // 05:30 UTC = 07:30 in Prague (summer time), 01:30 in New York.
  const now = "2026-07-01T05:30:00Z";
  const candidates = async () =>
    (
      await rows<{ user_id: string }>(`select user_id from jarvis_briefing_candidates($1, 1000)`, [
        now,
      ])
    ).map((r) => r.user_id);

  it("picks users whose morning has come, once a day, unlocked and active", async () => {
    const prague = await readyUser("Europe/Prague");
    const newYork = await readyUser("America/New_York");
    const lockedGame = await readyUser("Europe/Prague", "game");
    const unlockedGame = await readyUser("Europe/Prague", "game");
    await db.query(`insert into unlocks (user_id, key) values ($1, 'jarvis_morning_brief')`, [
      unlockedGame,
    ]);
    const off = await readyUser("Europe/Prague");
    await db.query(`update user_settings set jarvis_proactive = false where user_id = $1`, [off]);
    const done = await readyUser("Europe/Prague");
    await db.query(
      `insert into jarvis_suggestions (user_id, kind, type, text, dedupe_key)
       values ($1, 'briefing', 'briefing', 'x', 'briefing:2026-07-01')`,
      [done],
    );
    const idle = await createUser();
    await db.query(
      `update profiles set onboarding_completed_at = now(), mode = 'tool' where id = $1`,
      [idle],
    );

    const picked = await candidates();
    expect(picked).toContain(prague);
    expect(picked).toContain(unlockedGame);
    for (const user of [newYork, lockedGame, off, done, idle]) expect(picked).not.toContain(user);
  });

  it("skips a broken time zone instead of failing the whole run", async () => {
    const broken = await readyUser("Europe/Prague");
    await db
      .query(`update user_settings set timezone = 'Mars/Olympus' where user_id = $1`, [broken])
      .catch(() => undefined);
    const picked = await candidates();
    expect(picked).not.toContain(broken);
  });

  it("is closed to signed-in users", async () => {
    const user = await createUser();
    await asUser(user);
    await expect(db.query(`select * from jarvis_briefing_candidates(now(), 10)`)).rejects.toThrow();
    await asServer();
  });
});
